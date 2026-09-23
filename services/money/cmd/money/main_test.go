package main

import (
	"bytes"
	"context"
	"crypto/ed25519"
	"crypto/rand"
	"crypto/tls"
	"crypto/x509"
	"encoding/base64"
	"encoding/json"
	"io"
	"log/slog"
	"net/http"
	"os"
	"path/filepath"
	"strings"
	"testing"
	"time"

	"github.com/jackc/pgx/v5"

	"github.com/quantitynetwork/sagolik-close/services/money/internal/keys"
	"github.com/quantitynetwork/sagolik-close/services/money/internal/mtls"
	"github.com/quantitynetwork/sagolik-close/services/money/internal/store"
)

// End to end: real configuration, keyring, JWKS, mutual TLS, Postgres,
// migrations, assertion verification with the Postgres replay guard.
func TestServiceEndToEnd(t *testing.T) {
	dbURL := os.Getenv("MONEY_TEST_DATABASE_URL")
	if dbURL == "" {
		if os.Getenv("CI") != "" {
			t.Fatal("MONEY_TEST_DATABASE_URL must be set in CI")
		}
		t.Skip("MONEY_TEST_DATABASE_URL not set (run scripts/test-db.sh)")
	}
	ctx, cancel := context.WithCancel(context.Background())
	defer cancel()

	// Fresh database for this test.
	admin, err := pgx.Connect(ctx, dbURL)
	if err != nil {
		t.Fatal(err)
	}
	dbName := "e2e_" + strings.ReplaceAll(time.Now().Format("150405.000000"), ".", "")
	if _, err := admin.Exec(ctx, "create database "+dbName); err != nil {
		t.Fatal(err)
	}
	t.Cleanup(func() {
		_, _ = admin.Exec(context.Background(), "drop database "+dbName+" with (force)")
		_ = admin.Close(context.Background())
	})
	e2eURL := strings.Replace(dbURL, "/money_test", "/"+dbName, 1)

	dir := t.TempDir()
	write := func(name string, data []byte, mode os.FileMode) string {
		p := filepath.Join(dir, name)
		if err := os.WriteFile(p, data, mode); err != nil {
			t.Fatal(err)
		}
		return p
	}
	ca, _ := mtls.NewCA("e2e-ca", time.Hour)
	server, _ := mtls.NewServerCert(ca, []string{"127.0.0.1"}, time.Hour)
	web, _ := mtls.NewClientCert(ca, "spiffe://sagolik/web", time.Hour)
	keyring, _ := keys.NewKeyringDocument("v1")
	pub, priv, _ := ed25519.GenerateKey(rand.Reader)
	jwks := `{"keys":[{"kty":"OKP","crv":"Ed25519","kid":"web-1","x":"` + base64.RawURLEncoding.EncodeToString(pub) + `"}]}`

	env := map[string]string{
		"MONEY_ENV":                 "local",
		"MONEY_LISTEN_ADDR":         "127.0.0.1:0",
		"MONEY_HEALTH_ADDR":         "127.0.0.1:0",
		"MONEY_DATABASE_URL":        e2eURL,
		"MONEY_MIGRATE_ON_START":    "true",
		"MONEY_TLS_CERT_FILE":       write("server.pem", server.CertPEM, 0o600),
		"MONEY_TLS_KEY_FILE":        write("server-key.pem", server.KeyPEM, 0o600),
		"MONEY_TLS_CLIENT_CA_FILE":  write("ca.pem", ca.CertPEM, 0o600),
		"MONEY_TLS_ALLOWED_CLIENTS": "spiffe://sagolik/web",
		"MONEY_LOCAL_KEYRING_FILE":  write("keyring.json", keyring, 0o600),
		"MONEY_ASSERTION_JWKS_FILE": write("jwks.json", []byte(jwks), 0o644),
	}
	ready := make(chan listening, 1)
	done := make(chan error, 1)
	var logs bytes.Buffer
	go func() {
		done <- run(ctx, func(k string) string { return env[k] }, slog.New(slog.NewJSONHandler(&logs, nil)), ready)
	}()
	var addr listening
	select {
	case addr = <-ready:
	case err := <-done:
		t.Fatalf("service exited: %v\n%s", err, logs.String())
	case <-time.After(20 * time.Second):
		t.Fatal("service did not start")
	}

	pool := x509.NewCertPool()
	pool.AddCert(ca.Cert)
	webTLS, _ := web.TLS()
	client := &http.Client{Timeout: 5 * time.Second, Transport: &http.Transport{TLSClientConfig: &tls.Config{RootCAs: pool, Certificates: []tls.Certificate{webTLS}, MinVersion: tls.VersionTLS13}}}

	token := func(role string) string {
		enc := func(v any) string { b, _ := json.Marshal(v); return base64.RawURLEncoding.EncodeToString(b) }
		jti := make([]byte, 16)
		_, _ = rand.Read(jti)
		now := time.Now().Unix()
		in := enc(map[string]any{"alg": "EdDSA", "typ": "JWT", "kid": "web-1"}) + "." + enc(map[string]any{
			"iss": "sagolik-web", "aud": "sagolik-money", "sub": "4a6a4324-5fc8-4baa-a828-14210de77d3c",
			"txn": "a8db1096-1336-4467-8fd9-6415bd8939c0", "role": role, "aal": "aal2", "iat": now, "exp": now + 60,
			"jti": base64.RawURLEncoding.EncodeToString(jti)})
		return in + "." + base64.RawURLEncoding.EncodeToString(ed25519.Sign(priv, []byte(in)))
	}
	get := func(path, tok string) (int, map[string]any) {
		req, _ := http.NewRequest("GET", "https://"+addr.API+path, nil)
		req.Header.Set("Authorization", "Bearer "+tok)
		res, err := client.Do(req)
		if err != nil {
			t.Fatal(err)
		}
		defer res.Body.Close()
		var body map[string]any
		b, _ := io.ReadAll(res.Body)
		_ = json.Unmarshal(b, &body)
		return res.StatusCode, body
	}

	// Readiness proves database + key round trip.
	res, err := http.Get("http://" + addr.Health + "/readyz")
	if err != nil || res.StatusCode != 200 {
		t.Fatalf("readyz: %v %v", err, res)
	}
	_ = res.Body.Close()

	// Seed the ledger as the escrow integration will (M4).
	st, err := store.Open(ctx, e2eURL)
	if err != nil {
		t.Fatal(err)
	}
	defer st.Close()
	for _, m := range []store.Movement{
		{TransactionID: "a8db1096-1336-4467-8fd9-6415bd8939c0", Kind: store.KindExpectation, Amount: 20_000_000, Currency: "USD", Source: "e2e", IdempotencyKey: "e2e-expectation", RecordedBy: "system:e2e"},
		{TransactionID: "a8db1096-1336-4467-8fd9-6415bd8939c0", Kind: store.KindReceipt, Amount: 2_500_000, Currency: "USD", Source: "e2e", IdempotencyKey: "e2e-receipt-1", RecordedBy: "system:e2e"},
	} {
		if _, _, err := st.RecordMovement(ctx, m); err != nil {
			t.Fatal(err)
		}
	}

	if code, body := get("/v1/session", token("buyer")); code != 200 || body["userId"] != "4a6a4324-5fc8-4baa-a828-14210de77d3c" {
		t.Fatalf("session: %d %v", code, body)
	}
	code, body := get("/v1/transactions/a8db1096-1336-4467-8fd9-6415bd8939c0/funds", token("buyer"))
	if code != 200 {
		t.Fatalf("funds: %d %v", code, body)
	}
	bal := body["balances"].([]any)[0].(map[string]any)
	if bal["outstanding"].(float64) != 17_500_000 || bal["received"].(float64) != 2_500_000 {
		t.Fatalf("balances: %v", bal)
	}
	if code, _ := get("/v1/transactions/a8db1096-1336-4467-8fd9-6415bd8939c0/funds", token("buyer_agent")); code != 404 {
		t.Fatalf("agent must not see funds: %d", code)
	}
	// Replay across the Postgres guard.
	tok := token("buyer")
	if code, _ := get("/v1/session", tok); code != 200 {
		t.Fatal("first use")
	}
	if code, _ := get("/v1/session", tok); code != 401 {
		t.Fatalf("replay must be refused: %d", code)
	}
	// A client without a certificate can't even connect.
	bare := &http.Client{Timeout: 5 * time.Second, Transport: &http.Transport{TLSClientConfig: &tls.Config{RootCAs: pool, MinVersion: tls.VersionTLS13}}}
	if _, err := bare.Get("https://" + addr.API + "/v1/session"); err == nil {
		t.Fatal("connection without client certificate must fail")
	}
	// The funds read was audited and the chain verifies.
	if n, err := st.VerifyAuditChain(ctx); err != nil || n != 1 {
		t.Fatalf("audit chain: %d %v", n, err)
	}

	cancel()
	select {
	case err := <-done:
		if err != nil {
			t.Fatalf("shutdown: %v", err)
		}
	case <-time.After(20 * time.Second):
		t.Fatal("service did not shut down")
	}
	if strings.Contains(logs.String(), "a8db1096") || strings.Contains(logs.String(), e2eURL) {
		t.Fatal("logs must not contain transaction ids or the database url")
	}
}
