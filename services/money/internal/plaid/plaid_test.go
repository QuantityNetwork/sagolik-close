package plaid_test

import (
	"context"
	"crypto/ecdsa"
	"crypto/elliptic"
	"crypto/rand"
	"errors"
	"fmt"
	"os"
	"strings"
	"testing"
	"time"

	"github.com/quantitynetwork/sagolik-close/services/money/internal/plaid"
	"github.com/quantitynetwork/sagolik-close/services/money/internal/plaid/plaidtest"
	"github.com/quantitynetwork/sagolik-close/services/money/internal/redact"
)

func client(t *testing.T, f *plaidtest.Fake) *plaid.Client {
	t.Helper()
	c, err := plaid.New("sandbox", plaidtest.ClientID, redact.NewSecret(plaidtest.Secret))
	if err != nil {
		t.Fatal(err)
	}
	c.BaseURL = f.URL
	return c
}

func TestHostedLinkFlow(t *testing.T) {
	f := plaidtest.New()
	defer f.Close()
	c, ctx := client(t, f), context.Background()

	lt, err := c.CreateHostedLink(ctx, plaid.LinkRequest{ClientUserID: "u1", RedirectURI: "https://close.example/cb?link=1"})
	if err != nil || !strings.HasPrefix(lt.HostedURL, "https://") {
		t.Fatalf("create: %v %q", err, lt.HostedURL)
	}
	if fmt.Sprint(lt.Token) != "[REDACTED]" {
		t.Fatal("link token must be redacted when formatted")
	}
	if _, err := c.PublicToken(ctx, lt.Token); !errors.Is(err, plaid.ErrLinkNotFinished) {
		t.Fatalf("unfinished link: %v", err)
	}
	f.FinishLink(lt.Token.Reveal())
	pt, err := c.PublicToken(ctx, lt.Token)
	if err != nil {
		t.Fatal(err)
	}
	at, itemID, err := c.Exchange(ctx, pt)
	if err != nil || at.IsZero() || itemID == "" {
		t.Fatalf("exchange: %v", err)
	}
	item, err := c.Item(ctx, at)
	if err != nil || item.InstitutionName != "First Platypus Bank" {
		t.Fatalf("item: %v %+v", err, item)
	}
	ids, err := c.Identity(ctx, at)
	if err != nil || len(ids) != 2 || ids[0].Owners[0] != "Olivia Carter" || ids[0].Mask != "0000" {
		t.Fatalf("identity: %v %+v", err, ids)
	}
	bals, err := c.Balances(ctx, at, "acc_checking")
	if err != nil || *bals[0].Available != 25000000 || bals[0].Currency != "USD" {
		t.Fatalf("balances: %v %+v", err, bals)
	}
	if err := c.RemoveItem(ctx, at); err != nil || !f.ItemRemoved(itemID) {
		t.Fatalf("remove: %v", err)
	}
	var pe *plaid.Error
	if _, err := c.Item(ctx, at); !errors.As(err, &pe) || !pe.Reconnect {
		t.Fatalf("removed item should need reconnect: %v", err)
	}
}

func TestErrorsAreMappedAndCarryNoSecret(t *testing.T) {
	f := plaidtest.New()
	defer f.Close()
	c := client(t, f)
	c.Secret = redact.NewSecret("wrong-secret")
	_, err := c.CreateHostedLink(context.Background(), plaid.LinkRequest{ClientUserID: "u1", RedirectURI: "https://x/cb"})
	var pe *plaid.Error
	if !errors.As(err, &pe) || pe.Code != "INVALID_API_KEYS" {
		t.Fatalf("got %v", err)
	}
	if strings.Contains(err.Error(), "wrong-secret") || strings.Contains(pe.Message(), "wrong-secret") {
		t.Fatal("secret leaked into error")
	}
	c.Secret = redact.NewSecret(plaidtest.Secret)
	f.FailNext["/link/token/create"] = "RATE_LIMIT_EXCEEDED"
	_, err = c.CreateHostedLink(context.Background(), plaid.LinkRequest{ClientUserID: "u1", RedirectURI: "https://x/cb"})
	if !errors.As(err, &pe) || !pe.Retryable {
		t.Fatalf("rate limit should be retryable: %v", err)
	}
}

func TestNewRefusesUnknownEnvAndMissingKeys(t *testing.T) {
	if _, err := plaid.New("development", "id", redact.NewSecret("s")); err == nil {
		t.Fatal("unknown env accepted")
	}
	if _, err := plaid.New("sandbox", "", redact.NewSecret("s")); err == nil {
		t.Fatal("missing client id accepted")
	}
}

func TestWebhookVerification(t *testing.T) {
	f := plaidtest.New()
	defer f.Close()
	now := time.Now()
	v := &plaid.WebhookVerifier{Keys: client(t, f), Now: func() time.Time { return now }}
	ctx := context.Background()
	body := []byte("{\n  \"webhook_type\": \"ITEM\",\n  \"webhook_code\": \"ERROR\"\n}")

	if err := v.Verify(ctx, f.Sign(body, now.Add(-time.Minute)), body); err != nil {
		t.Fatalf("valid webhook rejected: %v", err)
	}
	calls := f.Calls["/webhook_verification_key/get"]
	_ = v.Verify(ctx, f.Sign(body, now), body)
	if f.Calls["/webhook_verification_key/get"] != calls {
		t.Fatal("key should be cached")
	}

	other, _ := ecdsa.GenerateKey(elliptic.P256(), rand.Reader)
	cases := map[string]struct {
		token string
		body  []byte
	}{
		"tampered body": {f.Sign(body, now), []byte(strings.Replace(string(body), "ERROR", "LOGIN_REPAIRED", 1))},
		"stale":         {f.Sign(body, now.Add(-6*time.Minute)), body},
		"future":        {f.Sign(body, now.Add(2*time.Minute)), body},
		"wrong key":     {plaidtest.SignWith(other, plaidtest.KeyID, body, now), body},
		"unknown kid":   {plaidtest.SignWith(f.Key, "00000000-0000-0000-0000-000000000000", body, now), body},
		"alg none":      {"eyJhbGciOiJub25lIiwia2lkIjoiNmM1NTE2ZTEtOTJkYy00NzllLWE4ZmYtNWE1MTk5MmUwMDAxIn0.e30.", body},
		"not a jwt":     {"abc", body},
		"empty":         {"", body},
		"bad kid chars": {plaidtest.SignWith(f.Key, "../../etc", body, now), body},
	}
	for name, tc := range cases {
		var rej *plaid.ErrWebhookRejected
		if err := v.Verify(ctx, tc.token, tc.body); !errors.As(err, &rej) {
			t.Errorf("%s: want rejection, got %v", name, err)
		}
	}
}

// TestLiveSandbox runs against Plaid's real sandbox when keys are present:
//
//	PLAID_CLIENT_ID=… PLAID_SECRET=… go test ./internal/plaid -run LiveSandbox -v
func TestLiveSandbox(t *testing.T) {
	id, secret := os.Getenv("PLAID_CLIENT_ID"), os.Getenv("PLAID_SECRET")
	if id == "" || secret == "" {
		t.Skip("PLAID_CLIENT_ID and PLAID_SECRET not set; live sandbox test skipped")
	}
	c, err := plaid.New("sandbox", id, redact.NewSecret(secret))
	if err != nil {
		t.Fatal(err)
	}
	ctx, cancel := context.WithTimeout(context.Background(), 60*time.Second)
	defer cancel()

	lt, err := c.CreateHostedLink(ctx, plaid.LinkRequest{ClientUserID: "sagolik-live-test", RedirectURI: "https://close.sagolik.com/api/v1/bank-connections/callback"})
	if err != nil {
		t.Fatalf("hosted link: %v", err)
	}
	t.Logf("hosted link url starts %s…", lt.HostedURL[:min(40, len(lt.HostedURL))])

	// First Platypus Bank, Plaid's sandbox institution.
	pt, err := c.SandboxPublicToken(ctx, "ins_109508", []string{"identity"})
	if err != nil {
		t.Fatalf("sandbox public token: %v", err)
	}
	at, itemID, err := c.Exchange(ctx, pt)
	if err != nil {
		t.Fatalf("exchange: %v", err)
	}
	defer func() {
		if err := c.RemoveItem(context.Background(), at); err != nil {
			t.Errorf("remove item: %v", err)
		}
	}()
	item, err := c.Item(ctx, at)
	if err != nil || item.ItemID != itemID {
		t.Fatalf("item: %v", err)
	}
	ids, err := c.Identity(ctx, at)
	if err != nil || len(ids) == 0 || len(ids[0].Owners) == 0 {
		t.Fatalf("identity: %v (%d accounts)", err, len(ids))
	}
	bals, err := c.Balances(ctx, at)
	if err != nil || len(bals) == 0 || bals[0].Current == nil {
		t.Fatalf("balances: %v", err)
	}
	t.Logf("live sandbox OK: %s, %d accounts, first owner %q", item.InstitutionName, len(ids), ids[0].Owners[0])

	// Plaid's real verification key endpoint rejects an unknown kid.
	if _, err := c.WebhookKey(ctx, "00000000-0000-0000-0000-000000000000"); err == nil {
		t.Fatal("unknown webhook key id accepted")
	}
}

func TestNamesMatch(t *testing.T) {
	yes := [][2]string{{"Olivia Carter", "CARTER, Olivia M."}, {"José Álvarez", "jose alvarez"}, {"Olivia Carter", "Olivia R Carter"}}
	no := [][2]string{{"Olivia Carter", "Oliver Carter"}, {"Olivia Carter", ""}, {"Olivia Carter", "Marcus Lee"}, {"A B", "A B"}}
	for _, p := range yes {
		if !plaid.NamesMatch(p[0], p[1]) {
			t.Errorf("%q vs %q should match", p[0], p[1])
		}
	}
	for _, p := range no {
		if plaid.NamesMatch(p[0], p[1]) {
			t.Errorf("%q vs %q should not match", p[0], p[1])
		}
	}
}
