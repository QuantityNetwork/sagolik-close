package store

import (
	"context"
	"errors"
	"fmt"
	"regexp"
	"strings"
	"time"

	"github.com/jackc/pgx/v5"

	"github.com/quantitynetwork/sagolik-close/services/money/internal/keys"
	"github.com/quantitynetwork/sagolik-close/services/money/internal/redact"
)

// Sealer is the envelope-encryption dependency for account numbers.
type Sealer interface {
	Seal(ctx context.Context, plaintext []byte, ec keys.Context) (string, error)
	Open(ctx context.Context, value string, ec keys.Context) ([]byte, error)
}

func accountContext(instructionID string) keys.Context {
	return keys.Context{Purpose: "instruction.account_number", RecordID: instructionID}
}

var (
	ErrNotFound           = errors.New("store: not found")
	ErrNotLatest          = errors.New("store: a newer version of these instructions exists")
	ErrAlreadyDecided     = errors.New("store: these instructions were already verified or rejected")
	ErrSelfVerification   = errors.New("store: instructions must be verified by someone other than their author")
	ErrNotVerified        = errors.New("store: these instructions haven't been independently verified")
	ErrCoolingOff         = errors.New("store: these instructions are in a security waiting period")
	ErrInvalidInstruction = errors.New("store: invalid instruction")
)

// CoolingOffError carries when the waiting period ends.
type CoolingOffError struct{ Until time.Time }

func (e *CoolingOffError) Error() string {
	return ErrCoolingOff.Error() + " until " + e.Until.UTC().Format(time.RFC3339)
}
func (e *CoolingOffError) Is(target error) bool { return target == ErrCoolingOff }

// NewInstruction is a request to record a (new version of) payment instructions.
type NewInstruction struct {
	TransactionID   string
	Purpose         string
	BeneficiaryName string
	BankName        string
	RoutingNumber   string
	AccountNumber   redact.Secret
	Currency        string
	CreatedBy       string
	CoolingOff      time.Duration // applied to every changed version (version > 1)
	HoursToClosing  *float64      // optional; a change close to closing is critical risk
	RequestID       string
	Now             time.Time
}

// Instruction is the masked view — the full account number never appears here.
type Instruction struct {
	ID                 string     `json:"id"`
	TransactionID      string     `json:"transactionId"`
	Purpose            string     `json:"purpose"`
	Version            int        `json:"version"`
	PreviousID         *string    `json:"previousId"`
	BeneficiaryName    string     `json:"beneficiaryName"`
	BankName           string     `json:"bankName"`
	RoutingNumber      string     `json:"routingNumber"`
	AccountMask        string     `json:"accountMask"`
	Currency           string     `json:"currency"`
	RiskLevel          string     `json:"riskLevel"`
	EffectiveAfter     *time.Time `json:"effectiveAfter"`
	CreatedBy          string     `json:"createdBy"`
	CreatedAt          time.Time  `json:"createdAt"`
	Status             string     `json:"status"` // pending_verification | verified | rejected | superseded
	Usable             bool       `json:"usable"`
	VerifiedBy         *string    `json:"verifiedBy"`
	VerifiedAt         *time.Time `json:"verifiedAt"`
	VerificationMethod *string    `json:"verificationMethod"`
}

// Revealed is returned only to the payer, only for usable instructions.
type Revealed struct {
	Instruction
	AccountNumber redact.Secret `json:"-"`
}

var (
	purposes      = map[string]bool{"earnest_money_to_escrow": true, "closing_funds_to_escrow": true, "seller_proceeds": true, "loan_payoff": true}
	routingRe     = regexp.MustCompile(`^[0-9]{9}$`)
	accountRe     = regexp.MustCompile(`^[0-9]{4,17}$`)
	verifyMethods = map[string]bool{"out_of_band_call": true, "in_person": true, "provider_attested": true}
)

// ValidABARouting checks a US routing number's checksum (3-7-1 weighting).
func ValidABARouting(r string) bool {
	if !routingRe.MatchString(r) {
		return false
	}
	w := [9]int{3, 7, 1, 3, 7, 1, 3, 7, 1}
	sum := 0
	for i, c := range r {
		sum += int(c-'0') * w[i]
	}
	return sum%10 == 0
}

func (n NewInstruction) validate() error {
	acct := n.AccountNumber.Reveal()
	bad := func(msg string) error { return fmt.Errorf("%w: %s", ErrInvalidInstruction, msg) }
	switch {
	case !uuidRe.MatchString(n.TransactionID) || !uuidRe.MatchString(n.CreatedBy):
		return bad("transaction and author must be uuids")
	case !purposes[n.Purpose]:
		return bad("unknown purpose")
	case len(strings.TrimSpace(n.BeneficiaryName)) < 2 || len(n.BeneficiaryName) > 140:
		return bad("beneficiary name")
	case len(strings.TrimSpace(n.BankName)) < 2 || len(n.BankName) > 140:
		return bad("bank name")
	case !ValidABARouting(n.RoutingNumber):
		return bad("routing number is not a valid US ABA number")
	case !accountRe.MatchString(acct):
		return bad("account number must be 4 to 17 digits")
	case !currencyRe.MatchString(n.Currency):
		return bad("currency")
	case n.CoolingOff < 0:
		return bad("cooling-off")
	}
	return nil
}

const instructionCols = `i.id, i.transaction_id, i.purpose, i.version, i.previous_id, i.beneficiary_name, i.bank_name, i.routing_number,
	i.account_mask, i.currency, i.risk_level, i.effective_after, i.created_by, i.created_at,
	(select max(version) from instructions l where l.transaction_id = i.transaction_id and l.purpose = i.purpose) as latest_version,
	d.kind, d.actor, d.occurred_at, d.method`

const instructionFrom = ` from instructions i
	left join instruction_events d on d.instruction_id = i.id and d.kind in ('verified', 'rejected')`

func scanInstruction(row pgx.Row, now time.Time) (Instruction, error) {
	var (
		in        Instruction
		latest    int
		kind      *string
		actor     *string
		decidedAt *time.Time
		method    *string
	)
	err := row.Scan(&in.ID, &in.TransactionID, &in.Purpose, &in.Version, &in.PreviousID, &in.BeneficiaryName, &in.BankName, &in.RoutingNumber,
		&in.AccountMask, &in.Currency, &in.RiskLevel, &in.EffectiveAfter, &in.CreatedBy, &in.CreatedAt, &latest, &kind, &actor, &decidedAt, &method)
	if err != nil {
		return in, err
	}
	switch {
	case in.Version < latest:
		in.Status = "superseded"
	case kind != nil && *kind == "rejected":
		in.Status = "rejected"
	case kind != nil && *kind == "verified":
		in.Status = "verified"
		in.VerifiedBy, in.VerifiedAt, in.VerificationMethod = actor, decidedAt, method
	default:
		in.Status = "pending_verification"
	}
	in.Usable = in.Status == "verified" && (in.EffectiveAfter == nil || !in.EffectiveAfter.After(now))
	return in, nil
}

// CreateInstruction records a new version, sealed, with its audit entry, atomically.
func (s *Store) CreateInstruction(ctx context.Context, env Sealer, n NewInstruction) (Instruction, error) {
	if err := n.validate(); err != nil {
		return Instruction{}, err
	}
	if n.Now.IsZero() {
		n.Now = time.Now()
	}
	acct := n.AccountNumber.Reveal()
	var out Instruction
	err := pgx.BeginFunc(ctx, s.pool, func(tx pgx.Tx) error {
		if _, err := tx.Exec(ctx, `select pg_advisory_xact_lock(hashtextextended($1, 7240115004))`, n.TransactionID+"/"+n.Purpose); err != nil {
			return err
		}
		var prevID *string
		var prevVersion int
		err := tx.QueryRow(ctx, `select id, version from instructions where transaction_id = $1 and purpose = $2 order by version desc limit 1`,
			n.TransactionID, n.Purpose).Scan(&prevID, &prevVersion)
		if err != nil && !errors.Is(err, pgx.ErrNoRows) {
			return err
		}
		id := newUUID()
		risk := "low"
		var effective *time.Time
		if prevID != nil {
			// Any change to where money goes is high risk; close to closing, critical.
			risk = "high"
			if n.HoursToClosing != nil && *n.HoursToClosing <= 72 {
				risk = "critical"
			}
			if n.CoolingOff > 0 {
				t := n.Now.Add(n.CoolingOff).UTC()
				effective = &t
			}
		}
		sealed, err := env.Seal(ctx, []byte(acct), accountContext(id))
		if err != nil {
			return fmt.Errorf("seal account number: %w", err)
		}
		if _, err := tx.Exec(ctx, `insert into instructions (id, transaction_id, purpose, version, previous_id, beneficiary_name, bank_name,
			routing_number, account_mask, account_number_sealed, currency, risk_level, effective_after, created_by, created_at)
			values ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15)`,
			id, n.TransactionID, n.Purpose, prevVersion+1, prevID, strings.TrimSpace(n.BeneficiaryName), strings.TrimSpace(n.BankName),
			n.RoutingNumber, acct[len(acct)-4:], sealed, n.Currency, risk, effective, n.CreatedBy, n.Now.UTC()); err != nil {
			return err
		}
		action := "instruction.created"
		if prevID != nil {
			action = "instruction.changed"
		}
		details := map[string]any{"instruction": id, "purpose": n.Purpose, "version": prevVersion + 1, "risk": risk, "mask": acct[len(acct)-4:]}
		if err := s.appendAuditInTx(ctx, tx, AuditEvent{Actor: "user:" + n.CreatedBy, Action: action, Subject: "transaction:" + n.TransactionID, RequestID: n.RequestID, Details: details}); err != nil {
			return err
		}
		out, err = scanInstruction(tx.QueryRow(ctx, `select `+instructionCols+instructionFrom+` where i.id = $1`, id), n.Now)
		return err
	})
	return out, err
}

// GetInstruction returns the masked view of one instruction.
func (s *Store) GetInstruction(ctx context.Context, id string, now time.Time) (Instruction, error) {
	if !uuidRe.MatchString(id) {
		return Instruction{}, ErrNotFound
	}
	in, err := scanInstruction(s.pool.QueryRow(ctx, `select `+instructionCols+instructionFrom+` where i.id = $1`, id), now)
	if errors.Is(err, pgx.ErrNoRows) {
		return in, ErrNotFound
	}
	return in, err
}

// ListInstructions returns every version for a transaction, newest first per purpose.
func (s *Store) ListInstructions(ctx context.Context, txID string, now time.Time) ([]Instruction, error) {
	if !uuidRe.MatchString(txID) {
		return nil, ErrNotFound
	}
	rows, err := s.pool.Query(ctx, `select `+instructionCols+instructionFrom+` where i.transaction_id = $1 order by i.purpose, i.version desc`, txID)
	if err != nil {
		return nil, err
	}
	defer rows.Close()
	out := []Instruction{}
	for rows.Next() {
		in, err := scanInstruction(rows, now)
		if err != nil {
			return nil, err
		}
		out = append(out, in)
	}
	return out, rows.Err()
}

// VerifyInstruction records second-person, out-of-band verification.
func (s *Store) VerifyInstruction(ctx context.Context, id, actor, method, reference, requestID string, now time.Time) (Instruction, error) {
	if !verifyMethods[method] {
		return Instruction{}, fmt.Errorf("%w: unknown verification method", ErrInvalidInstruction)
	}
	if len(reference) > 200 {
		return Instruction{}, fmt.Errorf("%w: reference too long", ErrInvalidInstruction)
	}
	var out Instruction
	err := pgx.BeginFunc(ctx, s.pool, func(tx pgx.Tx) error {
		in, err := s.lockedInstruction(ctx, tx, id, now)
		if err != nil {
			return err
		}
		switch {
		case in.Status == "superseded":
			return ErrNotLatest
		case in.Status != "pending_verification":
			return ErrAlreadyDecided
		case in.CreatedBy == actor:
			return ErrSelfVerification
		}
		if _, err := tx.Exec(ctx, `insert into instruction_events (instruction_id, kind, actor, method, reference, occurred_at) values ($1, 'verified', $2, $3, nullif($4, ''), $5)`,
			id, actor, method, reference, now.UTC()); err != nil {
			return err
		}
		if err := s.appendAuditInTx(ctx, tx, AuditEvent{Actor: "user:" + actor, Action: "instruction.verified", Subject: "transaction:" + in.TransactionID, RequestID: requestID,
			Details: map[string]any{"instruction": id, "version": in.Version, "method": method, "has_reference": reference != ""}}); err != nil {
			return err
		}
		out, err = scanInstruction(tx.QueryRow(ctx, `select `+instructionCols+instructionFrom+` where i.id = $1`, id), now)
		return err
	})
	return out, err
}

// RevealInstruction opens the account number of a usable instruction for the
// payer, and records that it was shown.
func (s *Store) RevealInstruction(ctx context.Context, env Sealer, id, actor, requestID string, now time.Time) (Revealed, error) {
	var out Revealed
	err := pgx.BeginFunc(ctx, s.pool, func(tx pgx.Tx) error {
		in, err := s.lockedInstruction(ctx, tx, id, now)
		if err != nil {
			return err
		}
		switch {
		case in.Status == "superseded":
			return ErrNotLatest
		case in.Status != "verified":
			return ErrNotVerified
		case !in.Usable:
			return &CoolingOffError{Until: *in.EffectiveAfter}
		}
		var sealed string
		if err := tx.QueryRow(ctx, `select account_number_sealed from instructions where id = $1`, id).Scan(&sealed); err != nil {
			return err
		}
		pt, err := env.Open(ctx, sealed, accountContext(id))
		if err != nil {
			return fmt.Errorf("open account number: %w", err)
		}
		defer redact.Wipe(pt)
		if _, err := tx.Exec(ctx, `insert into instruction_events (instruction_id, kind, actor, occurred_at) values ($1, 'revealed', $2, $3)`, id, actor, now.UTC()); err != nil {
			return err
		}
		if err := s.appendAuditInTx(ctx, tx, AuditEvent{Actor: "user:" + actor, Action: "instruction.revealed", Subject: "transaction:" + in.TransactionID, RequestID: requestID,
			Details: map[string]any{"instruction": id, "version": in.Version}}); err != nil {
			return err
		}
		out = Revealed{Instruction: in, AccountNumber: redact.NewSecret(string(pt))}
		return nil
	})
	return out, err
}

// lockedInstruction loads an instruction and serializes with other writers of its purpose.
func (s *Store) lockedInstruction(ctx context.Context, tx pgx.Tx, id string, now time.Time) (Instruction, error) {
	if !uuidRe.MatchString(id) {
		return Instruction{}, ErrNotFound
	}
	var txID, purpose string
	if err := tx.QueryRow(ctx, `select transaction_id, purpose from instructions where id = $1`, id).Scan(&txID, &purpose); err != nil {
		if errors.Is(err, pgx.ErrNoRows) {
			return Instruction{}, ErrNotFound
		}
		return Instruction{}, err
	}
	if _, err := tx.Exec(ctx, `select pg_advisory_xact_lock(hashtextextended($1, 7240115004))`, txID+"/"+purpose); err != nil {
		return Instruction{}, err
	}
	return scanInstruction(tx.QueryRow(ctx, `select `+instructionCols+instructionFrom+` where i.id = $1`, id), now)
}
