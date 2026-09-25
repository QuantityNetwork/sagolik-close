package store

import (
	"context"
	"errors"
	"fmt"
	"strings"
	"time"

	"github.com/jackc/pgx/v5"
	"github.com/jackc/pgx/v5/pgconn"

	"github.com/quantitynetwork/sagolik-close/services/money/internal/keys"
	"github.com/quantitynetwork/sagolik-close/services/money/internal/redact"
)

var (
	// ErrLinkUsed: this Hosted Link session already produced a connection.
	ErrLinkUsed = errors.New("store: this bank link was already completed")
	// ErrLinkExpired: the Hosted Link session is too old to complete.
	ErrLinkExpired = errors.New("store: this bank link has expired")
	// ErrDisconnected: the access token was destroyed.
	ErrDisconnected = errors.New("store: this bank connection was disconnected")
	// ErrInvalidBank: bank data failed validation.
	ErrInvalidBank = errors.New("store: invalid bank data")
)

func linkTokenContext(linkID string) keys.Context {
	return keys.Context{Purpose: "plaid.link_token", RecordID: linkID}
}

func accessTokenContext(connectionID string) keys.Context {
	return keys.Context{Purpose: "plaid.access_token", RecordID: connectionID}
}

// Link is a started Hosted Link session.
type Link struct {
	ID            string
	TransactionID string
	UserID        string
	ExpiresAt     time.Time
	ConnectionID  *string // set once completed
}

// NewLink records a Hosted Link session.
type NewLink struct {
	ID            string // optional; lets the caller put it in Plaid's redirect URI
	TransactionID string
	UserID        string
	LinkToken     redact.Secret
	ExpiresAt     time.Time
	RequestID     string
}

// CreateLink seals and records a link token.
func (s *Store) CreateLink(ctx context.Context, env Sealer, n NewLink) (Link, error) {
	if !uuidRe.MatchString(n.TransactionID) || !uuidRe.MatchString(n.UserID) || n.LinkToken.IsZero() {
		return Link{}, fmt.Errorf("%w: link", ErrInvalidBank)
	}
	id := n.ID
	if id == "" {
		id = newUUID()
	} else if !uuidRe.MatchString(id) {
		return Link{}, fmt.Errorf("%w: link id", ErrInvalidBank)
	}
	sealed, err := env.Seal(ctx, []byte(n.LinkToken.Reveal()), linkTokenContext(id))
	if err != nil {
		return Link{}, err
	}
	err = pgx.BeginFunc(ctx, s.pool, func(tx pgx.Tx) error {
		if _, err := tx.Exec(ctx, `insert into bank_links (id, transaction_id, user_id, link_token_sealed, expires_at) values ($1, $2, $3, $4, $5)`,
			id, n.TransactionID, n.UserID, sealed, n.ExpiresAt); err != nil {
			return err
		}
		return s.appendAuditInTx(ctx, tx, AuditEvent{Actor: "user:" + n.UserID, Action: "bank.link_started",
			Subject: "transaction:" + n.TransactionID, RequestID: n.RequestID, Details: map[string]any{"link": id, "provider": "plaid"}})
	})
	if err != nil {
		return Link{}, err
	}
	return Link{ID: id, TransactionID: n.TransactionID, UserID: n.UserID, ExpiresAt: n.ExpiresAt}, nil
}

// GetLink loads a link and opens its token.
func (s *Store) GetLink(ctx context.Context, env Sealer, id string) (Link, redact.Secret, error) {
	var l Link
	var sealed string
	if !uuidRe.MatchString(id) {
		return l, redact.Secret{}, ErrNotFound
	}
	err := s.pool.QueryRow(ctx, `select l.id, l.transaction_id, l.user_id, l.expires_at, l.link_token_sealed, c.id
		from bank_links l left join bank_connections c on c.link_id = l.id where l.id = $1`, id).
		Scan(&l.ID, &l.TransactionID, &l.UserID, &l.ExpiresAt, &sealed, &l.ConnectionID)
	if errors.Is(err, pgx.ErrNoRows) {
		return l, redact.Secret{}, ErrNotFound
	}
	if err != nil {
		return l, redact.Secret{}, err
	}
	pt, err := env.Open(ctx, sealed, linkTokenContext(l.ID))
	if err != nil {
		return l, redact.Secret{}, err
	}
	defer redact.Wipe(pt)
	return l, redact.NewSecret(string(pt)), nil
}

// NewAccount is an account reported at connection or refresh time.
type NewAccount struct {
	PlaidAccountID string
	Name           string
	Mask           string
	Type           string
	Subtype        string
	Currency       string
	OwnerMatched   bool
	OwnerCount     int
}

// NewConnection completes a link.
type NewConnection struct {
	LinkID           string
	TransactionID    string
	UserID           string
	ItemID           string
	InstitutionID    string
	InstitutionName  string
	ConsentExpiresAt *time.Time
	AccessToken      redact.Secret
	Accounts         []NewAccount
	RequestID        string
}

// FundsCheck is one proof-of-funds result.
type FundsCheck struct {
	ID             string    `json:"id"`
	AccountID      string    `json:"accountId"`
	TransactionID  string    `json:"transactionId"`
	CheckedBy      string    `json:"checkedBy"`
	RequiredAmount int64     `json:"requiredAmount"`
	Currency       string    `json:"currency"`
	Available      *int64    `json:"available"`
	Current        *int64    `json:"current"`
	Sufficient     bool      `json:"sufficient"`
	CheckedAt      time.Time `json:"checkedAt"`
}

// BankAccount is the masked view of an account.
type BankAccount struct {
	ID                 string      `json:"id"`
	ConnectionID       string      `json:"connectionId"`
	Name               string      `json:"name"`
	Mask               string      `json:"mask"`
	Type               string      `json:"type"`
	Subtype            string      `json:"subtype"`
	Currency           string      `json:"currency"`
	OwnershipMatched   *bool       `json:"ownershipMatched"`
	OwnershipCheckedAt *time.Time  `json:"ownershipCheckedAt"`
	LastFundsCheck     *FundsCheck `json:"lastFundsCheck"`
}

// Connection is the masked view of a bank connection (no item id, no token).
type Connection struct {
	ID               string        `json:"id"`
	TransactionID    string        `json:"transactionId"`
	UserID           string        `json:"userId"`
	Provider         string        `json:"provider"`
	InstitutionName  string        `json:"institutionName"`
	Status           string        `json:"status"`
	StatusAt         time.Time     `json:"statusAt"`
	ConsentExpiresAt *time.Time    `json:"consentExpiresAt"`
	CreatedAt        time.Time     `json:"createdAt"`
	Accounts         []BankAccount `json:"accounts"`
}

func (a NewAccount) valid() bool {
	return a.PlaidAccountID != "" && len(a.PlaidAccountID) <= 200 && strings.TrimSpace(a.Name) != "" && len(a.Name) <= 200 &&
		len(a.Mask) <= 4 && len(a.Type) <= 40 && len(a.Subtype) <= 40 && currencyRe.MatchString(a.Currency)
}

// CreateConnection stores the sealed token, accounts and ownership results in one transaction.
func (s *Store) CreateConnection(ctx context.Context, env Sealer, n NewConnection) (Connection, error) {
	switch {
	case !uuidRe.MatchString(n.LinkID) || !uuidRe.MatchString(n.TransactionID) || !uuidRe.MatchString(n.UserID):
		return Connection{}, fmt.Errorf("%w: ids", ErrInvalidBank)
	case n.ItemID == "" || n.AccessToken.IsZero():
		return Connection{}, fmt.Errorf("%w: item", ErrInvalidBank)
	}
	for _, a := range n.Accounts {
		if !a.valid() {
			return Connection{}, fmt.Errorf("%w: account", ErrInvalidBank)
		}
	}
	name := strings.TrimSpace(n.InstitutionName)
	if name == "" {
		name = "Your bank"
	}
	if len(name) > 200 {
		name = name[:200]
	}
	id := newUUID()
	sealed, err := env.Seal(ctx, []byte(n.AccessToken.Reveal()), accessTokenContext(id))
	if err != nil {
		return Connection{}, err
	}
	err = pgx.BeginFunc(ctx, s.pool, func(tx pgx.Tx) error {
		var instID *string
		if n.InstitutionID != "" {
			instID = &n.InstitutionID
		}
		if _, err := tx.Exec(ctx, `insert into bank_connections (id, link_id, transaction_id, user_id, provider, item_id, institution_id, institution_name, consent_expires_at, access_token_sealed)
			values ($1, $2, $3, $4, 'plaid', $5, $6, $7, $8, $9)`,
			id, n.LinkID, n.TransactionID, n.UserID, n.ItemID, instID, name, n.ConsentExpiresAt, sealed); err != nil {
			var pg *pgconn.PgError
			if errors.As(err, &pg) && pg.Code == "23505" {
				return ErrLinkUsed
			}
			return err
		}
		if _, err := tx.Exec(ctx, `insert into bank_connection_events (connection_id, status, source) values ($1, 'connected', 'user')`, id); err != nil {
			return err
		}
		for _, a := range n.Accounts {
			aid := newUUID()
			if _, err := tx.Exec(ctx, `insert into bank_accounts (id, connection_id, plaid_account_id, name, mask, type, subtype, currency) values ($1, $2, $3, $4, $5, $6, $7, $8)`,
				aid, id, a.PlaidAccountID, a.Name, a.Mask, a.Type, a.Subtype, a.Currency); err != nil {
				return err
			}
			if _, err := tx.Exec(ctx, `insert into ownership_checks (account_id, matched, owner_count) values ($1, $2, $3)`, aid, a.OwnerMatched, a.OwnerCount); err != nil {
				return err
			}
		}
		matched := 0
		for _, a := range n.Accounts {
			if a.OwnerMatched {
				matched++
			}
		}
		return s.appendAuditInTx(ctx, tx, AuditEvent{Actor: "user:" + n.UserID, Action: "bank.connected", Subject: "transaction:" + n.TransactionID,
			RequestID: n.RequestID, Details: map[string]any{"connection": id, "institution": name, "accounts": len(n.Accounts), "owner_matched": matched}})
	})
	if err != nil {
		return Connection{}, err
	}
	return s.GetConnection(ctx, id)
}

// accountLookup maps Plaid account ids to ours for a connection.
func (s *Store) accountLookup(ctx context.Context, connectionID string) (map[string]string, error) {
	rows, err := s.pool.Query(ctx, `select plaid_account_id, id from bank_accounts where connection_id = $1`, connectionID)
	if err != nil {
		return nil, err
	}
	out := map[string]string{}
	for rows.Next() {
		var pid, id string
		if err := rows.Scan(&pid, &id); err != nil {
			return nil, err
		}
		out[pid] = id
	}
	return out, rows.Err()
}

// PlaidAccountID returns the Plaid id for one of our account ids on a connection.
func (s *Store) PlaidAccountID(ctx context.Context, connectionID, accountID string) (string, error) {
	var pid string
	err := s.pool.QueryRow(ctx, `select plaid_account_id from bank_accounts where id = $1 and connection_id = $2`, accountID, connectionID).Scan(&pid)
	if errors.Is(err, pgx.ErrNoRows) {
		return "", ErrNotFound
	}
	return pid, err
}

// RecordRefresh adds ownership results (new accounts are added) and marks the connection connected.
func (s *Store) RecordRefresh(ctx context.Context, connectionID, actor string, accounts []NewAccount, requestID string) error {
	known, err := s.accountLookup(ctx, connectionID)
	if err != nil {
		return err
	}
	return pgx.BeginFunc(ctx, s.pool, func(tx pgx.Tx) error {
		for _, a := range accounts {
			if !a.valid() {
				return fmt.Errorf("%w: account", ErrInvalidBank)
			}
			aid, ok := known[a.PlaidAccountID]
			if !ok {
				aid = newUUID()
				if _, err := tx.Exec(ctx, `insert into bank_accounts (id, connection_id, plaid_account_id, name, mask, type, subtype, currency) values ($1, $2, $3, $4, $5, $6, $7, $8)`,
					aid, connectionID, a.PlaidAccountID, a.Name, a.Mask, a.Type, a.Subtype, a.Currency); err != nil {
					return err
				}
			}
			if _, err := tx.Exec(ctx, `insert into ownership_checks (account_id, matched, owner_count) values ($1, $2, $3)`, aid, a.OwnerMatched, a.OwnerCount); err != nil {
				return err
			}
		}
		if err := setStatusTx(ctx, tx, connectionID, "connected", "plaid_api", ""); err != nil {
			return err
		}
		return s.appendAuditInTx(ctx, tx, AuditEvent{Actor: "user:" + actor, Action: "bank.refreshed", Subject: "bank_connection:" + connectionID, RequestID: requestID})
	})
}

// setStatusTx appends a status event unless it is already the current status.
func setStatusTx(ctx context.Context, tx pgx.Tx, connectionID, status, source, detail string) error {
	var current string
	err := tx.QueryRow(ctx, `select status from bank_connection_events where connection_id = $1 order by id desc limit 1`, connectionID).Scan(&current)
	if err != nil && !errors.Is(err, pgx.ErrNoRows) {
		return err
	}
	if current == status || current == "revoked" { // revoked is final
		return nil
	}
	var d *string
	if detail != "" {
		if len(detail) > 200 {
			detail = detail[:200]
		}
		d = &detail
	}
	_, err = tx.Exec(ctx, `insert into bank_connection_events (connection_id, status, source, detail) values ($1, $2, $3, $4)`, connectionID, status, source, d)
	return err
}

// SetStatus records a status reported by Plaid (API error or webhook).
func (s *Store) SetStatus(ctx context.Context, connectionID, status, source, detail, requestID string) error {
	return pgx.BeginFunc(ctx, s.pool, func(tx pgx.Tx) error {
		if err := setStatusTx(ctx, tx, connectionID, status, source, detail); err != nil {
			return err
		}
		return s.appendAuditInTx(ctx, tx, AuditEvent{Actor: "provider:plaid", Action: "bank.status_changed", Subject: "bank_connection:" + connectionID,
			RequestID: requestID, Details: map[string]any{"status": status, "source": source}})
	})
}

const connectionCols = `c.id, c.transaction_id, c.user_id, c.provider, c.institution_name, c.consent_expires_at, c.created_at,
	e.status, e.occurred_at`
const connectionFrom = ` from bank_connections c
	join lateral (select status, occurred_at from bank_connection_events where connection_id = c.id order by id desc limit 1) e on true`

func (s *Store) scanConnections(ctx context.Context, where string, args ...any) ([]Connection, error) {
	rows, err := s.pool.Query(ctx, `select `+connectionCols+connectionFrom+` where `+where+` order by c.created_at desc`, args...)
	if err != nil {
		return nil, err
	}
	var conns []Connection
	for rows.Next() {
		var c Connection
		if err := rows.Scan(&c.ID, &c.TransactionID, &c.UserID, &c.Provider, &c.InstitutionName, &c.ConsentExpiresAt, &c.CreatedAt, &c.Status, &c.StatusAt); err != nil {
			return nil, err
		}
		c.Accounts = []BankAccount{}
		conns = append(conns, c)
	}
	if err := rows.Err(); err != nil {
		return nil, err
	}
	for i := range conns {
		if conns[i].Accounts, err = s.accounts(ctx, conns[i].ID); err != nil {
			return nil, err
		}
	}
	return conns, nil
}

func (s *Store) accounts(ctx context.Context, connectionID string) ([]BankAccount, error) {
	rows, err := s.pool.Query(ctx, `select a.id, a.connection_id, a.name, a.mask, a.type, a.subtype, a.currency, o.matched, o.checked_at,
		f.id, f.transaction_id, f.checked_by, f.required_amount, f.currency, f.available, f.current, f.sufficient, f.checked_at
		from bank_accounts a
		left join lateral (select matched, checked_at from ownership_checks where account_id = a.id order by id desc limit 1) o on true
		left join lateral (select * from funds_checks where account_id = a.id order by checked_at desc limit 1) f on true
		where a.connection_id = $1 order by a.created_at, a.name`, connectionID)
	if err != nil {
		return nil, err
	}
	defer rows.Close()
	out := []BankAccount{}
	for rows.Next() {
		var a BankAccount
		var f FundsCheck
		var fid, ftx, fby, fcur *string
		var freq *int64
		var fsuff *bool
		var fat *time.Time
		if err := rows.Scan(&a.ID, &a.ConnectionID, &a.Name, &a.Mask, &a.Type, &a.Subtype, &a.Currency, &a.OwnershipMatched, &a.OwnershipCheckedAt,
			&fid, &ftx, &fby, &freq, &fcur, &f.Available, &f.Current, &fsuff, &fat); err != nil {
			return nil, err
		}
		if fid != nil {
			f.ID, f.AccountID, f.TransactionID, f.CheckedBy, f.RequiredAmount, f.Currency, f.Sufficient, f.CheckedAt = *fid, a.ID, *ftx, *fby, *freq, *fcur, *fsuff, *fat
			a.LastFundsCheck = &f
		}
		out = append(out, a)
	}
	return out, rows.Err()
}

// GetConnection loads one connection with its accounts.
func (s *Store) GetConnection(ctx context.Context, id string) (Connection, error) {
	if !uuidRe.MatchString(id) {
		return Connection{}, ErrNotFound
	}
	conns, err := s.scanConnections(ctx, `c.id = $1`, id)
	if err != nil {
		return Connection{}, err
	}
	if len(conns) == 0 {
		return Connection{}, ErrNotFound
	}
	return conns[0], nil
}

// ListConnections returns one person's connections for a transaction.
func (s *Store) ListConnections(ctx context.Context, txID, userID string) ([]Connection, error) {
	return s.scanConnections(ctx, `c.transaction_id = $1 and c.user_id = $2`, txID, userID)
}

// AccessToken opens a connection's token, or ErrDisconnected.
func (s *Store) AccessToken(ctx context.Context, env Sealer, connectionID string) (redact.Secret, error) {
	var sealed *string
	err := s.pool.QueryRow(ctx, `select access_token_sealed from bank_connections where id = $1`, connectionID).Scan(&sealed)
	if errors.Is(err, pgx.ErrNoRows) {
		return redact.Secret{}, ErrNotFound
	}
	if err != nil {
		return redact.Secret{}, err
	}
	if sealed == nil {
		return redact.Secret{}, ErrDisconnected
	}
	pt, err := env.Open(ctx, *sealed, accessTokenContext(connectionID))
	if err != nil {
		return redact.Secret{}, err
	}
	defer redact.Wipe(pt)
	return redact.NewSecret(string(pt)), nil
}

// Disconnect destroys the access token and marks the connection revoked.
func (s *Store) Disconnect(ctx context.Context, connectionID, actor, source, requestID string) error {
	return pgx.BeginFunc(ctx, s.pool, func(tx pgx.Tx) error {
		if _, err := tx.Exec(ctx, `update bank_connections set access_token_sealed = null where id = $1 and access_token_sealed is not null`, connectionID); err != nil {
			return err
		}
		if err := setStatusTx(ctx, tx, connectionID, "revoked", source, ""); err != nil {
			return err
		}
		return s.appendAuditInTx(ctx, tx, AuditEvent{Actor: actor, Action: "bank.disconnected", Subject: "bank_connection:" + connectionID, RequestID: requestID})
	})
}

// NewFundsCheck is a balance compared with the amount required.
type NewFundsCheck struct {
	AccountID      string
	TransactionID  string
	CheckedBy      string
	RequiredAmount int64
	Currency       string
	Available      *int64
	Current        *int64
	RequestID      string
}

// RecordFundsCheck stores a proof-of-funds result. Sufficient means the
// available balance (what can actually be sent) covers the amount required.
func (s *Store) RecordFundsCheck(ctx context.Context, n NewFundsCheck) (FundsCheck, error) {
	if n.RequiredAmount <= 0 || n.RequiredAmount > 1_000_000_000_00 || !currencyRe.MatchString(n.Currency) || !uuidRe.MatchString(n.TransactionID) || !uuidRe.MatchString(n.CheckedBy) {
		return FundsCheck{}, fmt.Errorf("%w: amount", ErrInvalidBank)
	}
	f := FundsCheck{ID: newUUID(), AccountID: n.AccountID, TransactionID: n.TransactionID, CheckedBy: n.CheckedBy,
		RequiredAmount: n.RequiredAmount, Currency: n.Currency, Available: n.Available, Current: n.Current}
	f.Sufficient = n.Available != nil && *n.Available >= n.RequiredAmount
	err := pgx.BeginFunc(ctx, s.pool, func(tx pgx.Tx) error {
		if err := tx.QueryRow(ctx, `insert into funds_checks (id, account_id, transaction_id, checked_by, required_amount, currency, available, current, sufficient)
			values ($1, $2, $3, $4, $5, $6, $7, $8, $9) returning checked_at`,
			f.ID, f.AccountID, f.TransactionID, f.CheckedBy, f.RequiredAmount, f.Currency, f.Available, f.Current, f.Sufficient).Scan(&f.CheckedAt); err != nil {
			return err
		}
		return s.appendAuditInTx(ctx, tx, AuditEvent{Actor: "user:" + n.CheckedBy, Action: "bank.funds_checked", Subject: "transaction:" + n.TransactionID,
			RequestID: n.RequestID, Details: map[string]any{"account": n.AccountID, "required": n.RequiredAmount, "currency": n.Currency, "sufficient": f.Sufficient}})
	})
	return f, err
}

// RecentFundsChecks counts checks on an account since a time (balance calls are billed per request).
func (s *Store) RecentFundsChecks(ctx context.Context, accountID string, since time.Time) (int, error) {
	var n int
	err := s.pool.QueryRow(ctx, `select count(*) from funds_checks where account_id = $1 and checked_at >= $2`, accountID, since).Scan(&n)
	return n, err
}

// NewID returns a random UUID for records whose id the caller needs up front.
func NewID() string { return newUUID() }

// ProofOfFunds is what other parties may see: the result, never the balance.
type ProofOfFunds struct {
	UserID           string    `json:"userId"`
	InstitutionName  string    `json:"institutionName"`
	AccountMask      string    `json:"accountMask"`
	OwnershipMatched bool      `json:"ownershipMatched"`
	RequiredAmount   int64     `json:"requiredAmount"`
	Currency         string    `json:"currency"`
	Sufficient       bool      `json:"sufficient"`
	CheckedAt        time.Time `json:"checkedAt"`
}

// ProofOfFundsFor returns the latest check per account for a transaction.
func (s *Store) ProofOfFundsFor(ctx context.Context, txID string) ([]ProofOfFunds, error) {
	rows, err := s.pool.Query(ctx, `select distinct on (f.account_id) c.user_id, c.institution_name, a.mask,
		coalesce((select matched from ownership_checks o where o.account_id = a.id order by o.id desc limit 1), false),
		f.required_amount, f.currency, f.sufficient, f.checked_at
		from funds_checks f join bank_accounts a on a.id = f.account_id join bank_connections c on c.id = a.connection_id
		where f.transaction_id = $1 order by f.account_id, f.checked_at desc`, txID)
	if err != nil {
		return nil, err
	}
	defer rows.Close()
	out := []ProofOfFunds{}
	for rows.Next() {
		var p ProofOfFunds
		if err := rows.Scan(&p.UserID, &p.InstitutionName, &p.AccountMask, &p.OwnershipMatched, &p.RequiredAmount, &p.Currency, &p.Sufficient, &p.CheckedAt); err != nil {
			return nil, err
		}
		out = append(out, p)
	}
	return out, rows.Err()
}

// WebhookSeen reports whether a webhook body was already processed.
func (s *Store) WebhookSeen(ctx context.Context, bodySHA256 []byte) (bool, error) {
	var seen bool
	err := s.pool.QueryRow(ctx, `select exists(select 1 from plaid_webhooks where body_sha256 = $1)`, bodySHA256).Scan(&seen)
	return seen, err
}

// ConnectionForItem finds the connection for a Plaid item id ("" if none).
func (s *Store) ConnectionForItem(ctx context.Context, itemID string) (string, error) {
	if itemID == "" {
		return "", nil
	}
	var id string
	err := s.pool.QueryRow(ctx, `select id from bank_connections where item_id = $1`, itemID).Scan(&id)
	if errors.Is(err, pgx.ErrNoRows) {
		return "", nil
	}
	return id, err
}

// RecordWebhook marks a verified webhook as processed. It is written after the
// webhook's effect, so a failure part-way lets Plaid's retry finish the job
// (status changes are idempotent).
func (s *Store) RecordWebhook(ctx context.Context, bodySHA256 []byte, typ, code, itemID string) error {
	var item *string
	if itemID != "" {
		item = &itemID
	}
	_, err := s.pool.Exec(ctx, `insert into plaid_webhooks (body_sha256, webhook_type, webhook_code, item_id) values ($1, $2, $3, $4) on conflict (body_sha256) do nothing`,
		bodySHA256, truncate(typ, 60), truncate(code, 60), item)
	return err
}

func truncate(s string, n int) string {
	if len(s) > n {
		return s[:n]
	}
	return s
}
