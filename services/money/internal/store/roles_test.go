package store

import (
	"context"
	"crypto/rand"
	"encoding/hex"
	"os"
	"testing"
)

func TestRuntimeRoleSetup(t *testing.T) {
	url := os.Getenv("MONEY_TEST_DATABASE_URL")
	if url == "" {
		if os.Getenv("CI") != "" {
			t.Fatal("MONEY_TEST_DATABASE_URL must be set in CI")
		}
		t.Skip("MONEY_TEST_DATABASE_URL not set (run scripts/test-db.sh)")
	}
	ctx := context.Background()
	s, err := Open(ctx, url)
	if err != nil {
		t.Fatal(err)
	}
	defer s.Close()
	b := make([]byte, 4)
	_, _ = rand.Read(b)
	login := "id-money-" + hex.EncodeToString(b)
	if _, err := s.pool.Exec(ctx, `create role "`+login+`" login`); err != nil {
		t.Fatal(err)
	}
	t.Cleanup(func() { _, _ = s.pool.Exec(context.Background(), `drop role if exists "`+login+`"`) })

	for i := 0; i < 2; i++ { // idempotent
		if err := s.EnsureRuntimeRole(ctx); err != nil {
			t.Fatal(err)
		}
	}
	if err := s.GrantRuntimeRole(ctx, login); err != nil {
		t.Fatal(err)
	}
	var member bool
	if err := s.pool.QueryRow(ctx, `select pg_has_role($1, 'money_app', 'usage')`, login).Scan(&member); err != nil || !member {
		t.Fatalf("the login role should use money_app's privileges: %v %v", member, err)
	}
	for _, bad := range []string{"no-such-role-" + hex.EncodeToString(b), `x"; drop table audit_events; --`, RuntimeRole, ""} {
		if err := s.GrantRuntimeRole(ctx, bad); err == nil {
			t.Errorf("%q: expected refusal", bad)
		}
	}
	if _, err := s.CreateEntraPrincipal(ctx, "id-money", "not-an-object-id"); err == nil {
		t.Error("a malformed object id must be refused before reaching the database")
	}
}
