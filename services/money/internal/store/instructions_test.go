package store

import (
	"context"
	"errors"
	"strings"
	"testing"
	"time"

	"github.com/quantitynetwork/sagolik-close/services/money/internal/keys"
	"github.com/quantitynetwork/sagolik-close/services/money/internal/redact"
)

const (
	escrowOfficer = "43964358-5d5f-4521-a52c-63562021c400"
	titleOfficer  = "11111111-1111-4111-8111-111111111111"
	buyer         = "4a6a4324-5fc8-4baa-a828-14210de77d3c"
)

func envelope(t *testing.T) *keys.Envelope {
	t.Helper()
	doc, _ := keys.NewKeyringDocument("v1")
	p, err := keys.ParseKeyring(doc)
	if err != nil {
		t.Fatal(err)
	}
	return keys.NewEnvelope(p)
}

func newInstr(account string, now time.Time) NewInstruction {
	return NewInstruction{TransactionID: txA, Purpose: "closing_funds_to_escrow", BeneficiaryName: "Maple Title & Escrow — Trust Account",
		BankName: "Sandbox National Bank", RoutingNumber: "021000021", AccountNumber: redact.NewSecret(account), Currency: "USD",
		CreatedBy: escrowOfficer, CoolingOff: 24 * time.Hour, Now: now}
}

func TestABARouting(t *testing.T) {
	for _, ok := range []string{"021000021", "011000015", "121000358"} {
		if !ValidABARouting(ok) {
			t.Errorf("%s should be valid", ok)
		}
	}
	for _, bad := range []string{"021000022", "12345678", "02100002a", ""} {
		if ValidABARouting(bad) {
			t.Errorf("%s should be invalid", bad)
		}
	}
}

func TestInstructionLifecycle(t *testing.T) {
	s, _ := testStore(t)
	env := envelope(t)
	ctx := context.Background()
	t0 := time.Date(2026, 9, 24, 12, 0, 0, 0, time.UTC)

	v1, err := s.CreateInstruction(ctx, env, newInstr("000123456789", t0))
	if err != nil {
		t.Fatal(err)
	}
	if v1.Version != 1 || v1.Status != "pending_verification" || v1.Usable || v1.EffectiveAfter != nil || v1.AccountMask != "6789" || v1.RiskLevel != "low" {
		t.Fatalf("v1 = %+v", v1)
	}
	// The stored value is sealed, never the plain account number.
	var sealed string
	_ = s.pool.QueryRow(ctx, `select account_number_sealed from instructions where id = $1`, v1.ID).Scan(&sealed)
	if !strings.HasPrefix(sealed, "sce1.") || strings.Contains(sealed, "000123456789") {
		t.Fatal("account number must be sealed at rest")
	}

	// Payer can't see details before verification.
	if _, err := s.RevealInstruction(ctx, env, v1.ID, buyer, "r", t0); !errors.Is(err, ErrNotVerified) {
		t.Fatalf("reveal before verification: %v", err)
	}
	// Author can't verify their own instructions.
	if _, err := s.VerifyInstruction(ctx, v1.ID, escrowOfficer, "out_of_band_call", "call #1", "r", t0); !errors.Is(err, ErrSelfVerification) {
		t.Fatalf("self verification: %v", err)
	}
	if _, err := s.VerifyInstruction(ctx, v1.ID, titleOfficer, "email", "", "r", t0); !errors.Is(err, ErrInvalidInstruction) {
		t.Fatalf("unknown method: %v", err)
	}
	v1, err = s.VerifyInstruction(ctx, v1.ID, titleOfficer, "out_of_band_call", "Called Marcus on file number", "r", t0)
	if err != nil || v1.Status != "verified" || !v1.Usable || *v1.VerifiedBy != titleOfficer {
		t.Fatalf("verify: %+v %v", v1, err)
	}
	if _, err := s.VerifyInstruction(ctx, v1.ID, titleOfficer, "in_person", "", "r", t0); !errors.Is(err, ErrAlreadyDecided) {
		t.Fatalf("double verification: %v", err)
	}
	rev, err := s.RevealInstruction(ctx, env, v1.ID, buyer, "r", t0)
	if err != nil || rev.AccountNumber.Reveal() != "000123456789" {
		t.Fatalf("reveal: %v", err)
	}

	// A change close to closing: new version, critical risk, 24h cooling-off.
	in := newInstr("000987654321", t0.Add(time.Hour))
	h := 48.0
	in.HoursToClosing = &h
	v2, err := s.CreateInstruction(ctx, env, in)
	if err != nil {
		t.Fatal(err)
	}
	if v2.Version != 2 || v2.PreviousID == nil || *v2.PreviousID != v1.ID || v2.RiskLevel != "critical" || v2.EffectiveAfter == nil {
		t.Fatalf("v2 = %+v", v2)
	}
	old, _ := s.GetInstruction(ctx, v1.ID, t0.Add(time.Hour))
	if old.Status != "superseded" || old.Usable {
		t.Fatalf("v1 must be superseded: %+v", old)
	}
	if _, err := s.RevealInstruction(ctx, env, v1.ID, buyer, "r", t0.Add(time.Hour)); !errors.Is(err, ErrNotLatest) {
		t.Fatalf("superseded reveal: %v", err)
	}
	if _, err := s.VerifyInstruction(ctx, v2.ID, titleOfficer, "out_of_band_call", "call #2", "r", t0.Add(2*time.Hour)); err != nil {
		t.Fatal(err)
	}
	// Verified, but still inside the waiting period.
	var coe *CoolingOffError
	if _, err := s.RevealInstruction(ctx, env, v2.ID, buyer, "r", t0.Add(3*time.Hour)); !errors.As(err, &coe) || !coe.Until.Equal(v2.EffectiveAfter.UTC()) {
		t.Fatalf("cooling-off: %v", err)
	}
	after := v2.EffectiveAfter.Add(time.Second)
	if rev, err := s.RevealInstruction(ctx, env, v2.ID, buyer, "r", after); err != nil || rev.AccountNumber.Reveal() != "000987654321" {
		t.Fatalf("reveal after cooling-off: %v", err)
	}

	list, _ := s.ListInstructions(ctx, txA, after)
	if len(list) != 2 || list[0].Version != 2 || !list[0].Usable || list[1].Status != "superseded" {
		t.Fatalf("list = %+v", list)
	}
	// Every step is in the audit chain.
	var actions []string
	rows, _ := s.pool.Query(ctx, `select action from audit_events order by seq`)
	for rows.Next() {
		var a string
		_ = rows.Scan(&a)
		actions = append(actions, a)
	}
	want := "instruction.created,instruction.verified,instruction.revealed,instruction.changed,instruction.verified,instruction.revealed"
	if strings.Join(actions, ",") != want {
		t.Fatalf("audit = %v", actions)
	}
	if n, err := s.VerifyAuditChain(ctx); err != nil || n != 6 {
		t.Fatalf("chain: %d %v", n, err)
	}
	// History is immutable.
	for _, q := range []string{`update instructions set account_mask = '0000'`, `delete from instruction_events`, `update instruction_events set kind = 'rejected'`} {
		if _, err := s.pool.Exec(ctx, q); pgCode(err) != "42501" {
			t.Errorf("%q must be refused: %v", q, err)
		}
	}
}

func TestInstructionValidation(t *testing.T) {
	s, _ := testStore(t)
	env := envelope(t)
	now := time.Now()
	for name, mutate := range map[string]func(*NewInstruction){
		"bad routing checksum": func(n *NewInstruction) { n.RoutingNumber = "021000022" },
		"letters in account":   func(n *NewInstruction) { n.AccountNumber = redact.NewSecret("12AB5678") },
		"short account":        func(n *NewInstruction) { n.AccountNumber = redact.NewSecret("123") },
		"unknown purpose":      func(n *NewInstruction) { n.Purpose = "tip" },
		"bad currency":         func(n *NewInstruction) { n.Currency = "usd" },
	} {
		n := newInstr("000123456789", now)
		mutate(&n)
		if _, err := s.CreateInstruction(context.Background(), env, n); !errors.Is(err, ErrInvalidInstruction) {
			t.Errorf("%s: %v", name, err)
		}
	}
}
