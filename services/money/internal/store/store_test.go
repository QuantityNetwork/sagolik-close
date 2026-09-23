package store

import (
	"context"
	"crypto/rand"
	"encoding/hex"
	"errors"
	"os"
	"sync"
	"testing"
	"time"

	"github.com/jackc/pgx/v5"
	"github.com/jackc/pgx/v5/pgconn"
	"github.com/jackc/pgx/v5/pgxpool"
)

// testStore returns a store on a fresh schema. Requires MONEY_TEST_DATABASE_URL
// (a superuser/owner connection); run scripts/test-db.sh for a throwaway Postgres.
func testStore(t *testing.T) (*Store, string) {
	t.Helper()
	url := os.Getenv("MONEY_TEST_DATABASE_URL")
	if url == "" {
		if os.Getenv("CI") != "" {
			t.Fatal("MONEY_TEST_DATABASE_URL must be set in CI")
		}
		t.Skip("MONEY_TEST_DATABASE_URL not set (run scripts/test-db.sh)")
	}
	ctx := context.Background()
	b := make([]byte, 6)
	_, _ = rand.Read(b)
	schema := "t_" + hex.EncodeToString(b)
	admin, err := pgx.Connect(ctx, url)
	if err != nil {
		t.Fatal(err)
	}
	for _, q := range []string{
		`do $$ begin if not exists (select 1 from pg_roles where rolname = 'money_app') then create role money_app nologin; end if; end $$`,
		`create schema ` + schema,
		`grant usage on schema ` + schema + ` to money_app`,
	} {
		if _, err := admin.Exec(ctx, q); err != nil {
			t.Fatal(err)
		}
	}
	t.Cleanup(func() {
		_, _ = admin.Exec(context.Background(), `drop schema `+schema+` cascade`)
		_ = admin.Close(context.Background())
	})
	s := openAs(t, url, schema, "")
	if _, err := s.Migrate(ctx); err != nil {
		t.Fatal(err)
	}
	return s, schema
}

func openAs(t *testing.T, url, schema, role string) *Store {
	t.Helper()
	cfg, err := pgxpool.ParseConfig(url)
	if err != nil {
		t.Fatal(err)
	}
	cfg.ConnConfig.RuntimeParams["search_path"] = schema
	if role != "" {
		cfg.AfterConnect = func(ctx context.Context, c *pgx.Conn) error {
			_, err := c.Exec(ctx, "set role "+role)
			return err
		}
	}
	s, err := OpenConfig(context.Background(), cfg)
	if err != nil {
		t.Fatal(err)
	}
	t.Cleanup(s.Close)
	return s
}

func pgCode(err error) string {
	var pgErr *pgconn.PgError
	if errors.As(err, &pgErr) {
		return pgErr.Code
	}
	return ""
}

func TestMigrateIsIdempotent(t *testing.T) {
	s, _ := testStore(t)
	applied, err := s.Migrate(context.Background())
	if err != nil || len(applied) != 0 {
		t.Fatalf("second migrate applied %v, err %v", applied, err)
	}
}

func TestAuditChain(t *testing.T) {
	s, _ := testStore(t)
	ctx := context.Background()
	for i, action := range []string{"instruction.created", "instruction.verified", "payment_intent.approved"} {
		e, err := s.AppendAudit(ctx, AuditEvent{Actor: "user:u1", Action: action, Subject: "transaction:t1", RequestID: "req-1",
			Details: map[string]any{"version": i + 1, "b": "x", "a": []int{1, 2}}})
		if err != nil {
			t.Fatal(err)
		}
		if e.Seq == 0 || len(e.Hash) != 32 {
			t.Fatalf("bad event %+v", e)
		}
	}
	if n, err := s.VerifyAuditChain(ctx); err != nil || n != 3 {
		t.Fatalf("verify: %d %v", n, err)
	}
	// The table refuses edits…
	_, err := s.pool.Exec(ctx, `update audit_events set details = '{"version":99}' where seq = 2`)
	if pgCode(err) != "42501" {
		t.Fatalf("update must be refused, got %v", err)
	}
	if _, err := s.pool.Exec(ctx, `delete from audit_events`); pgCode(err) != "42501" {
		t.Fatalf("delete must be refused, got %v", err)
	}
	// …and if an owner bypasses the trigger, verification pinpoints the row.
	if _, err := s.pool.Exec(ctx, `alter table audit_events disable trigger audit_events_append_only`); err != nil {
		t.Fatal(err)
	}
	if _, err := s.pool.Exec(ctx, `update audit_events set details = '{"version":99}' where seq = 2`); err != nil {
		t.Fatal(err)
	}
	_, err = s.VerifyAuditChain(ctx)
	var ce *ChainError
	if !errors.As(err, &ce) || ce.Seq != 2 {
		t.Fatalf("tampering not detected at seq 2: %v", err)
	}
}

func TestAuditChainConcurrentAppends(t *testing.T) {
	s, _ := testStore(t)
	ctx := context.Background()
	var wg sync.WaitGroup
	errs := make(chan error, 25)
	for i := 0; i < 25; i++ {
		wg.Add(1)
		go func() {
			defer wg.Done()
			_, err := s.AppendAudit(ctx, AuditEvent{Actor: "system:test", Action: "ledger.recorded", Subject: "transaction:t"})
			errs <- err
		}()
	}
	wg.Wait()
	close(errs)
	for err := range errs {
		if err != nil {
			t.Fatal(err)
		}
	}
	if n, err := s.VerifyAuditChain(ctx); err != nil || n != 25 {
		t.Fatalf("verify: %d %v", n, err)
	}
}

const txA = "a8db1096-1336-4467-8fd9-6415bd8939c0"

func mv(kind string, amount int64, key string) Movement {
	return Movement{TransactionID: txA, Kind: kind, Amount: amount, Currency: "USD", Source: "provider:test", IdempotencyKey: key, RecordedBy: "system:test"}
}

func TestLedger(t *testing.T) {
	s, _ := testStore(t)
	ctx := context.Background()
	must := func(m Movement) {
		t.Helper()
		if _, created, err := s.RecordMovement(ctx, m); err != nil || !created {
			t.Fatalf("record %+v: created=%v err=%v", m, created, err)
		}
	}
	must(mv(KindExpectation, 20_000_000, "expect-closing-funds"))
	must(mv(KindReceipt, 15_000_000, "escrow-receipt-0001"))

	sum, err := s.FundsSummary(ctx, txA)
	if err != nil || len(sum) != 1 {
		t.Fatalf("summary: %v %v", sum, err)
	}
	if got := sum[0]; got.Expected != 20_000_000 || got.Outstanding != 5_000_000 || got.Received != 15_000_000 || got.Disbursed != 0 {
		t.Fatalf("summary = %+v", got)
	}

	// Idempotent replay: same key, same contents → no new posting.
	if _, created, err := s.RecordMovement(ctx, mv(KindReceipt, 15_000_000, "escrow-receipt-0001")); err != nil || created {
		t.Fatalf("replay: created=%v err=%v", created, err)
	}
	// Same key, different contents → conflict.
	if _, _, err := s.RecordMovement(ctx, mv(KindReceipt, 1, "escrow-receipt-0001")); !errors.Is(err, ErrConflict) {
		t.Fatalf("expected conflict, got %v", err)
	}
	// Can't disburse more than escrow reported holding.
	if _, _, err := s.RecordMovement(ctx, mv(KindDisbursement, 15_000_001, "disburse-0001")); !errors.Is(err, ErrInsufficientHeld) {
		t.Fatalf("expected insufficient held, got %v", err)
	}
	must(mv(KindDisbursement, 15_000_000, "disburse-0002"))
	sum, _ = s.FundsSummary(ctx, txA)
	if got := sum[0]; got.Received != 0 || got.Disbursed != 15_000_000 || got.Outstanding != 5_000_000 {
		t.Fatalf("after disbursement = %+v", got)
	}

	for name, bad := range map[string]Movement{
		"zero amount":  mv(KindReceipt, 0, "k-zero-amount"),
		"bad currency": {TransactionID: txA, Kind: KindReceipt, Amount: 1, Currency: "usd", Source: "s", IdempotencyKey: "k-currency", RecordedBy: "r"},
		"unknown kind": mv("refund", 1, "k-unknown-kind"),
		"short key":    mv(KindReceipt, 1, "k"),
		"bad tx id":    {TransactionID: "x", Kind: KindReceipt, Amount: 1, Currency: "USD", Source: "s", IdempotencyKey: "k-bad-txid", RecordedBy: "r"},
	} {
		if _, _, err := s.RecordMovement(ctx, bad); err == nil {
			t.Errorf("%s: expected validation error", name)
		}
	}
}

func TestLedgerMustBalanceInTheDatabase(t *testing.T) {
	s, _ := testStore(t)
	ctx := context.Background()
	err := pgx.BeginFunc(ctx, s.pool, func(tx pgx.Tx) error {
		id := newUUID()
		if _, err := tx.Exec(ctx, `insert into ledger_groups (id, transaction_id, kind, currency, source, idempotency_key, recorded_by) values ($1, $2, 'receipt', 'USD', 's', 'unbalanced-1', 'r')`, id, txA); err != nil {
			return err
		}
		_, err := tx.Exec(ctx, `insert into ledger_entries (group_id, account, amount) values ($1, 'escrow_received', 100), ($1, 'funds_due', -99)`, id)
		return err
	})
	if pgCode(err) != "23514" {
		t.Fatalf("unbalanced group must fail at commit, got %v", err)
	}
	if _, _, err := s.RecordMovement(ctx, mv(KindExpectation, 100, "expect-once")); err != nil {
		t.Fatal(err)
	}
	for _, q := range []string{`update ledger_entries set amount = 1`, `delete from ledger_groups`, `truncate ledger_entries cascade`} {
		if _, err := s.pool.Exec(ctx, q); pgCode(err) != "42501" {
			t.Errorf("%q must be refused, got %v", q, err)
		}
	}
}

// The runtime role can append and read, nothing else.
func TestAppRolePrivileges(t *testing.T) {
	s, schema := testStore(t)
	ctx := context.Background()
	if _, _, err := s.RecordMovement(ctx, mv(KindExpectation, 100, "owner-seed-1")); err != nil {
		t.Fatal(err)
	}
	app := openAs(t, os.Getenv("MONEY_TEST_DATABASE_URL"), schema, "money_app")
	if _, err := app.AppendAudit(ctx, AuditEvent{Actor: "user:u", Action: "session.checked", Subject: "user:u"}); err != nil {
		t.Fatalf("app role must append audit: %v", err)
	}
	if _, _, err := app.RecordMovement(ctx, mv(KindReceipt, 100, "app-receipt-1")); err != nil {
		t.Fatalf("app role must record movements: %v", err)
	}
	if _, err := app.FundsSummary(ctx, txA); err != nil {
		t.Fatal(err)
	}
	for _, q := range []string{
		`update audit_events set actor = 'x'`,
		`delete from ledger_entries`,
		`truncate audit_events`,
		`alter table audit_events disable trigger audit_events_append_only`,
		`drop table ledger_entries cascade`,
		`create table evil (id int)`,
		`update schema_migrations set version = 'x'`,
	} {
		if _, err := app.pool.Exec(ctx, q); err == nil {
			t.Errorf("app role executed %q", q)
		}
	}
}

func TestReplayGuard(t *testing.T) {
	s, _ := testStore(t)
	ctx := context.Background()
	g := s.ReplayGuard()
	exp := time.Now().Add(time.Minute)
	if ok, err := g.Use(ctx, "jti-000000000000001", exp); err != nil || !ok {
		t.Fatalf("first use: %v %v", ok, err)
	}
	if ok, err := g.Use(ctx, "jti-000000000000001", exp); err != nil || ok {
		t.Fatalf("second use must report replay: %v %v", ok, err)
	}
	if n, err := s.PruneReplay(ctx, time.Now().Add(2*time.Minute)); err != nil || n != 1 {
		t.Fatalf("prune: %d %v", n, err)
	}
}
