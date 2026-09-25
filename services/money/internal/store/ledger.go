package store

import (
	"context"
	"crypto/rand"
	"errors"
	"fmt"
	"regexp"

	"github.com/jackc/pgx/v5"
	"github.com/jackc/pgx/v5/pgconn"
)

// Movement kinds and the balanced lines each one posts. Amounts are integer
// cents; the service never holds these funds — it mirrors what the licensed
// escrow partner and providers report.
const (
	KindExpectation  = "expectation"  // closing funds the buyer must send to escrow
	KindReceipt      = "receipt"      // escrow partner confirmed funds received
	KindDisbursement = "disbursement" // escrow partner confirmed funds paid out
)

var postings = map[string][2]string{ // debit (+), credit (−)
	KindExpectation:  {"funds_due", "expected_source"},
	KindReceipt:      {"escrow_received", "funds_due"},
	KindDisbursement: {"escrow_disbursed", "escrow_received"},
}

// Movement is one business event to record.
type Movement struct {
	TransactionID  string
	Kind           string
	Amount         int64 // cents, > 0
	Currency       string
	Source         string // e.g. "provider:softpro:event:123"
	IdempotencyKey string
	RecordedBy     string
}

// Summary is derived from the ledger for one transaction and currency.
type Summary struct {
	Currency    string `json:"currency"`
	Expected    int64  `json:"expected"`    // total the buyer has been asked to send
	Outstanding int64  `json:"outstanding"` // still due (negative = over-received)
	Received    int64  `json:"received"`    // currently held by escrow (reported)
	Disbursed   int64  `json:"disbursed"`
}

var (
	uuidRe     = regexp.MustCompile(`^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$`)
	currencyRe = regexp.MustCompile(`^[A-Z]{3}$`)
	// ErrInsufficientHeld: a reported disbursement exceeds what escrow reported holding.
	ErrInsufficientHeld = errors.New("store: disbursement exceeds funds reported held")
	// ErrInvalidMovement: the movement failed validation.
	ErrInvalidMovement = errors.New("store: invalid movement")
)

func (m Movement) validate() error {
	switch {
	case !uuidRe.MatchString(m.TransactionID):
		return fmt.Errorf("%w: transaction id must be a uuid", ErrInvalidMovement)
	case postings[m.Kind] == [2]string{}:
		return fmt.Errorf("%w: unknown movement kind %q", ErrInvalidMovement, m.Kind)
	case m.Amount <= 0:
		return fmt.Errorf("%w: amount must be positive", ErrInvalidMovement)
	case !currencyRe.MatchString(m.Currency):
		return fmt.Errorf("%w: currency must be ISO 4217", ErrInvalidMovement)
	case m.Source == "" || m.RecordedBy == "":
		return fmt.Errorf("%w: source and recorded_by are required", ErrInvalidMovement)
	case len(m.IdempotencyKey) < 8 || len(m.IdempotencyKey) > 200:
		return fmt.Errorf("%w: idempotency key must be 8-200 characters", ErrInvalidMovement)
	}
	return nil
}

// RecordMovement posts a balanced group. Replaying the same idempotency key
// returns the original group with created=false; the same key with different
// contents is a conflict.
func (s *Store) RecordMovement(ctx context.Context, m Movement) (groupID string, created bool, err error) {
	if err := m.validate(); err != nil {
		return "", false, err
	}
	err = pgx.BeginFunc(ctx, s.pool, func(tx pgx.Tx) error {
		// Serialize movements per transaction so the held-funds check is exact.
		if _, err := tx.Exec(ctx, `select pg_advisory_xact_lock(hashtextextended($1, 7240115003))`, m.TransactionID); err != nil {
			return err
		}
		var existing Movement
		var id string
		qerr := tx.QueryRow(ctx,
			`select g.id, g.transaction_id, g.kind, g.currency, g.source, (select max(amount) from ledger_entries e where e.group_id = g.id)
			 from ledger_groups g where g.idempotency_key = $1`, m.IdempotencyKey).
			Scan(&id, &existing.TransactionID, &existing.Kind, &existing.Currency, &existing.Source, &existing.Amount)
		if qerr == nil {
			if existing.TransactionID != m.TransactionID || existing.Kind != m.Kind || existing.Currency != m.Currency || existing.Amount != m.Amount {
				return fmt.Errorf("%w: idempotency key reused with different contents", ErrConflict)
			}
			groupID = id
			return nil
		}
		if !errors.Is(qerr, pgx.ErrNoRows) {
			return qerr
		}
		if m.Kind == KindDisbursement {
			held, err := balance(ctx, tx, m.TransactionID, m.Currency, "escrow_received")
			if err != nil {
				return err
			}
			if m.Amount > held {
				return ErrInsufficientHeld
			}
		}
		groupID = newUUID()
		if _, err := tx.Exec(ctx,
			`insert into ledger_groups (id, transaction_id, kind, currency, source, idempotency_key, recorded_by) values ($1, $2, $3, $4, $5, $6, $7)`,
			groupID, m.TransactionID, m.Kind, m.Currency, m.Source, m.IdempotencyKey, m.RecordedBy); err != nil {
			return err
		}
		p := postings[m.Kind]
		if _, err := tx.Exec(ctx, `insert into ledger_entries (group_id, account, amount) values ($1, $2, $3), ($1, $4, $5)`,
			groupID, p[0], m.Amount, p[1], -m.Amount); err != nil {
			return err
		}
		created = true
		return s.appendAuditInTx(ctx, tx, AuditEvent{Actor: m.RecordedBy, Action: "ledger.recorded", Subject: "transaction:" + m.TransactionID,
			Details: map[string]any{"group": groupID, "kind": m.Kind, "amount": m.Amount, "currency": m.Currency, "source": m.Source}})
	})
	var pgErr *pgconn.PgError
	if errors.As(err, &pgErr) && pgErr.Code == "23505" { // concurrent insert of the same key
		return "", false, fmt.Errorf("%w: idempotency key in use", ErrConflict)
	}
	return groupID, created, err
}

func balance(ctx context.Context, q pgx.Tx, txID, currency, account string) (int64, error) {
	var b int64
	err := q.QueryRow(ctx,
		`select coalesce(sum(e.amount), 0) from ledger_entries e join ledger_groups g on g.id = e.group_id
		 where g.transaction_id = $1 and g.currency = $2 and e.account = $3`, txID, currency, account).Scan(&b)
	return b, err
}

// FundsSummary derives balances for a transaction, one row per currency.
func (s *Store) FundsSummary(ctx context.Context, txID string) ([]Summary, error) {
	if !uuidRe.MatchString(txID) {
		return nil, errors.New("store: transaction id must be a uuid")
	}
	rows, err := s.pool.Query(ctx,
		`select g.currency,
		        coalesce(sum(e.amount) filter (where e.account = 'expected_source'), 0),
		        coalesce(sum(e.amount) filter (where e.account = 'funds_due'), 0),
		        coalesce(sum(e.amount) filter (where e.account = 'escrow_received'), 0),
		        coalesce(sum(e.amount) filter (where e.account = 'escrow_disbursed'), 0)
		 from ledger_groups g join ledger_entries e on e.group_id = g.id
		 where g.transaction_id = $1 group by g.currency order by g.currency`, txID)
	if err != nil {
		return nil, err
	}
	defer rows.Close()
	out := []Summary{}
	for rows.Next() {
		var sm Summary
		var expectedSource int64
		if err := rows.Scan(&sm.Currency, &expectedSource, &sm.Outstanding, &sm.Received, &sm.Disbursed); err != nil {
			return nil, err
		}
		sm.Expected = -expectedSource
		out = append(out, sm)
	}
	return out, rows.Err()
}

func newUUID() string {
	var b [16]byte
	if _, err := rand.Read(b[:]); err != nil {
		panic(err) // crypto/rand failing is unrecoverable
	}
	b[6] = (b[6] & 0x0f) | 0x40
	b[8] = (b[8] & 0x3f) | 0x80
	return fmt.Sprintf("%x-%x-%x-%x-%x", b[0:4], b[4:6], b[6:8], b[8:10], b[10:16])
}
