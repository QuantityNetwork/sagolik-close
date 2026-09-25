package store

import (
	"bytes"
	"context"
	"crypto/sha256"
	"encoding/binary"
	"encoding/json"
	"errors"
	"fmt"
	"time"

	"github.com/jackc/pgx/v5"
)

// AuditEvent is one entry in the tamper-evident audit chain.
type AuditEvent struct {
	Seq        int64
	OccurredAt time.Time
	Actor      string // "user:<id>", "system:<source>", "provider:<id>"
	Action     string // e.g. "instruction.verified"
	Subject    string // e.g. "transaction:<id>"
	RequestID  string
	Details    map[string]any // must not contain secrets
	PrevHash   []byte
	Hash       []byte
}

var genesis = make([]byte, 32)

// canonicalDetails renders details as JSON with sorted keys (encoding/json sorts map keys).
func canonicalDetails(d map[string]any) (string, error) {
	if d == nil {
		d = map[string]any{}
	}
	b, err := json.Marshal(d)
	return string(b), err
}

func chainHash(prev []byte, occurred time.Time, actor, action, subject, requestID, details string) []byte {
	h := sha256.New()
	h.Write(prev)
	for _, f := range []string{occurred.UTC().Format(time.RFC3339Nano), actor, action, subject, requestID, details} {
		var n [8]byte
		binary.BigEndian.PutUint64(n[:], uint64(len(f)))
		h.Write(n[:])
		h.Write([]byte(f))
	}
	return h.Sum(nil)
}

// AppendAudit adds an event to the chain. Appends are serialized with a
// transaction-scoped advisory lock so the chain has a single, total order.
func (s *Store) AppendAudit(ctx context.Context, e AuditEvent) (AuditEvent, error) {
	details, err := canonicalDetails(e.Details)
	if err != nil {
		return e, fmt.Errorf("store: audit details: %w", err)
	}
	// Postgres keeps microseconds; hash exactly what will be stored.
	occurred := e.OccurredAt
	if occurred.IsZero() {
		occurred = time.Now()
	}
	occurred = occurred.UTC().Truncate(time.Microsecond)
	err = pgx.BeginFunc(ctx, s.pool, func(tx pgx.Tx) error {
		return appendAuditTx(ctx, tx, &e, occurred, details)
	})
	return e, err
}

// appendAuditInTx appends inside a caller's transaction, so the audited change
// and its audit entry commit (or roll back) together.
func (s *Store) appendAuditInTx(ctx context.Context, tx pgx.Tx, e AuditEvent) error {
	details, err := canonicalDetails(e.Details)
	if err != nil {
		return fmt.Errorf("store: audit details: %w", err)
	}
	occurred := e.OccurredAt
	if occurred.IsZero() {
		occurred = time.Now()
	}
	return appendAuditTx(ctx, tx, &e, occurred.UTC().Truncate(time.Microsecond), details)
}

func appendAuditTx(ctx context.Context, tx pgx.Tx, e *AuditEvent, occurred time.Time, details string) error {
	if _, err := tx.Exec(ctx, `select pg_advisory_xact_lock(7240115002)`); err != nil {
		return err
	}
	prev := genesis
	err := tx.QueryRow(ctx, `select hash from audit_events order by seq desc limit 1`).Scan(&prev)
	if err != nil && !errors.Is(err, pgx.ErrNoRows) {
		return err
	}
	hash := chainHash(prev, occurred, e.Actor, e.Action, e.Subject, e.RequestID, details)
	if err := tx.QueryRow(ctx,
		`insert into audit_events (occurred_at, actor, action, subject, request_id, details, prev_hash, hash)
		 values ($1, $2, $3, $4, $5, $6, $7, $8) returning seq`,
		occurred, e.Actor, e.Action, e.Subject, e.RequestID, details, prev, hash).Scan(&e.Seq); err != nil {
		return err
	}
	e.OccurredAt, e.PrevHash, e.Hash = occurred, prev, hash
	return nil
}

// ChainError reports the first audit row that doesn't match the chain.
type ChainError struct {
	Seq    int64
	Reason string
}

func (e *ChainError) Error() string {
	return fmt.Sprintf("audit chain broken at seq %d: %s", e.Seq, e.Reason)
}

// VerifyAuditChain recomputes every hash in order. It returns the number of
// verified events, or a *ChainError at the first inconsistency.
func (s *Store) VerifyAuditChain(ctx context.Context) (int, error) {
	rows, err := s.pool.Query(ctx, `select seq, occurred_at, actor, action, subject, request_id, details, prev_hash, hash from audit_events order by seq`)
	if err != nil {
		return 0, err
	}
	defer rows.Close()
	prev, n := genesis, 0
	for rows.Next() {
		var (
			seq                                        int64
			occurred                                   time.Time
			actor, action, subject, requestID, details string
			prevHash, hash                             []byte
		)
		if err := rows.Scan(&seq, &occurred, &actor, &action, &subject, &requestID, &details, &prevHash, &hash); err != nil {
			return n, err
		}
		if !bytes.Equal(prevHash, prev) {
			return n, &ChainError{Seq: seq, Reason: "prev_hash does not link to the previous event"}
		}
		if !bytes.Equal(hash, chainHash(prevHash, occurred, actor, action, subject, requestID, details)) {
			return n, &ChainError{Seq: seq, Reason: "hash does not match contents"}
		}
		prev, n = hash, n+1
	}
	return n, rows.Err()
}
