package store

import (
	"context"
	"crypto/sha256"
	"errors"
	"os"
	"strings"
	"testing"
	"time"

	"github.com/quantitynetwork/sagolik-close/services/money/internal/redact"
)

func TestBankConnectionLifecycle(t *testing.T) {
	owner, schema := testStore(t)
	s := openAs(t, os.Getenv("MONEY_TEST_DATABASE_URL"), schema, "money_app")
	env := envelope(t)
	ctx := context.Background()

	link, err := s.CreateLink(ctx, env, NewLink{TransactionID: txA, UserID: buyer, LinkToken: redact.NewSecret("link-sandbox-abc"), ExpiresAt: time.Now().Add(30 * time.Minute)})
	if err != nil {
		t.Fatal(err)
	}
	got, tok, err := s.GetLink(ctx, env, link.ID)
	if err != nil || tok.Reveal() != "link-sandbox-abc" || got.ConnectionID != nil || got.UserID != buyer {
		t.Fatalf("get link: %v %+v", err, got)
	}
	var sealed string
	_ = owner.pool.QueryRow(ctx, `select link_token_sealed from bank_links where id = $1`, link.ID).Scan(&sealed)
	if strings.Contains(sealed, "link-sandbox") {
		t.Fatal("link token stored in the clear")
	}

	nc := NewConnection{LinkID: link.ID, TransactionID: txA, UserID: buyer, ItemID: "item-1", InstitutionID: "ins_109508", InstitutionName: "First Platypus Bank",
		AccessToken: redact.NewSecret("access-sandbox-secret"), Accounts: []NewAccount{
			{PlaidAccountID: "acc_checking", Name: "Plaid Checking", Mask: "0000", Type: "depository", Subtype: "checking", Currency: "USD", OwnerMatched: true, OwnerCount: 1},
			{PlaidAccountID: "acc_savings", Name: "Plaid Saving", Mask: "1111", Type: "depository", Subtype: "savings", Currency: "USD", OwnerMatched: false, OwnerCount: 1},
		}}
	conn, err := s.CreateConnection(ctx, env, nc)
	if err != nil {
		t.Fatal(err)
	}
	if conn.Status != "connected" || len(conn.Accounts) != 2 || conn.Accounts[0].OwnershipMatched == nil {
		t.Fatalf("connection: %+v", conn)
	}
	if _, err := s.CreateConnection(ctx, env, nc); !errors.Is(err, ErrLinkUsed) {
		t.Fatalf("second completion must be refused: %v", err)
	}
	_ = owner.pool.QueryRow(ctx, `select access_token_sealed from bank_connections where id = $1`, conn.ID).Scan(&sealed)
	if !strings.HasPrefix(sealed, "sce1.") || strings.Contains(sealed, "access-sandbox") {
		t.Fatal("access token must be sealed")
	}
	if at, err := s.AccessToken(ctx, env, conn.ID); err != nil || at.Reveal() != "access-sandbox-secret" {
		t.Fatalf("access token: %v", err)
	}

	// Proof of funds.
	checking := conn.Accounts[0].ID
	avail, cur := int64(250_000_00), int64(250_100_00)
	f, err := s.RecordFundsCheck(ctx, NewFundsCheck{AccountID: checking, TransactionID: txA, CheckedBy: buyer, RequiredAmount: 100_000_00, Currency: "USD", Available: &avail, Current: &cur})
	if err != nil || !f.Sufficient {
		t.Fatalf("funds check: %v %+v", err, f)
	}
	low := int64(50_00)
	if f, _ := s.RecordFundsCheck(ctx, NewFundsCheck{AccountID: checking, TransactionID: txA, CheckedBy: buyer, RequiredAmount: 100_000_00, Currency: "USD", Available: &low}); f.Sufficient {
		t.Fatal("insufficient balance reported sufficient")
	}
	if f, _ := s.RecordFundsCheck(ctx, NewFundsCheck{AccountID: checking, TransactionID: txA, CheckedBy: buyer, RequiredAmount: 1, Currency: "USD", Current: &cur}); f.Sufficient {
		t.Fatal("unknown available balance must not count as sufficient")
	}
	if _, err := s.RecordFundsCheck(ctx, NewFundsCheck{AccountID: checking, TransactionID: txA, CheckedBy: buyer, RequiredAmount: 0, Currency: "USD"}); !errors.Is(err, ErrInvalidBank) {
		t.Fatalf("zero amount accepted: %v", err)
	}
	proof, err := s.ProofOfFundsFor(ctx, txA)
	if err != nil || len(proof) != 1 || proof[0].AccountMask != "0000" || !proof[0].OwnershipMatched || proof[0].Sufficient {
		t.Fatalf("proof of funds (latest wins): %v %+v", err, proof)
	}

	// Refresh adds ownership results and new accounts.
	if err := s.RecordRefresh(ctx, conn.ID, buyer, []NewAccount{
		{PlaidAccountID: "acc_checking", Name: "Plaid Checking", Mask: "0000", Type: "depository", Subtype: "checking", Currency: "USD", OwnerMatched: true, OwnerCount: 1},
		{PlaidAccountID: "acc_new", Name: "New", Mask: "2222", Type: "depository", Subtype: "checking", Currency: "USD", OwnerMatched: true, OwnerCount: 1},
	}, "req"); err != nil {
		t.Fatal(err)
	}
	list, err := s.ListConnections(ctx, txA, buyer)
	if err != nil || len(list) != 1 || len(list[0].Accounts) != 3 {
		t.Fatalf("list: %v %+v", err, list)
	}
	if other, _ := s.ListConnections(ctx, txA, escrowOfficer); len(other) != 0 {
		t.Fatal("another person's connections listed")
	}

	// Webhooks are stored once and find their connection.
	h := sha256.Sum256([]byte(`{"webhook_type":"ITEM"}`))
	if cid, err := s.ConnectionForItem(ctx, "item-1"); err != nil || cid != conn.ID {
		t.Fatalf("connection for item: %v %q", err, cid)
	}
	if seen, _ := s.WebhookSeen(ctx, h[:]); seen {
		t.Fatal("unseen webhook reported seen")
	}
	for range 2 {
		if err := s.RecordWebhook(ctx, h[:], "ITEM", "ERROR", "item-1"); err != nil {
			t.Fatalf("record webhook: %v", err)
		}
	}
	if seen, _ := s.WebhookSeen(ctx, h[:]); !seen {
		t.Fatal("recorded webhook not seen")
	}
	if err := s.SetStatus(ctx, conn.ID, "reauthentication_required", "plaid_webhook", "ITEM_LOGIN_REQUIRED", "req"); err != nil {
		t.Fatal(err)
	}
	if c, _ := s.GetConnection(ctx, conn.ID); c.Status != "reauthentication_required" {
		t.Fatalf("status %q", c.Status)
	}

	// Disconnect destroys the token; revoked is final.
	if err := s.Disconnect(ctx, conn.ID, "user:"+buyer, "user", "req"); err != nil {
		t.Fatal(err)
	}
	if _, err := s.AccessToken(ctx, env, conn.ID); !errors.Is(err, ErrDisconnected) {
		t.Fatalf("token after disconnect: %v", err)
	}
	_ = s.SetStatus(ctx, conn.ID, "connected", "plaid_webhook", "", "req")
	if c, _ := s.GetConnection(ctx, conn.ID); c.Status != "revoked" {
		t.Fatalf("revoked must be final, got %q", c.Status)
	}

	// The runtime role can't rewrite history or restore a token.
	for _, q := range []string{
		`update bank_connections set institution_name = 'x'`,
		`update bank_connections set access_token_sealed = 'sce1.forged'`,
		`delete from bank_connections`,
		`update funds_checks set sufficient = true`,
		`delete from ownership_checks`,
		`update bank_connection_events set status = 'connected'`,
		`truncate plaid_webhooks`,
	} {
		if _, err := s.pool.Exec(ctx, q); err == nil {
			t.Errorf("app role executed %q", q)
		}
	}
	if n, err := owner.VerifyAuditChain(ctx); err != nil || n < 5 {
		t.Fatalf("audit chain: %d %v", n, err)
	}
}
