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
	"fmt"
	"io"
	"log/slog"
	"net/http"
	"os"
	"path/filepath"
	"slices"
	"strings"
	"testing"
	"time"

	"github.com/jackc/pgx/v5"

	"github.com/quantitynetwork/sagolik-close/services/money/internal/keys"
	"github.com/quantitynetwork/sagolik-close/services/money/internal/mtls"
	"github.com/quantitynetwork/sagolik-close/services/money/internal/plaid/plaidtest"
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

	var tokenFor func(user, role string, stepUp bool) string
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

	fake := plaidtest.New()
	defer fake.Close()
	fake.Transactions = []map[string]any{
		{"transaction_id": "t1", "account_id": "acc_checking", "date": "2027-03-05", "name": "HIGH COUNTRY SERVICES", "amount": 450.0, "pending": false},
		{"transaction_id": "t2", "account_id": "acc_checking", "date": "2027-03-06", "name": "PAYROLL", "amount": -3200.5, "pending": false},
		{"transaction_id": "t3", "account_id": "acc_credit", "date": "2027-03-06", "name": "CARD PURCHASE", "amount": 12.0, "pending": false},
	}
	env := map[string]string{
		"MONEY_PLAID_ENV":               "sandbox",
		"MONEY_PLAID_CLIENT_ID":         plaidtest.ClientID,
		"MONEY_PLAID_SECRET_FILE":       write("plaid-secret", []byte(plaidtest.Secret+"\n"), 0o600),
		"MONEY_PLAID_BASE_URL":          fake.URL,
		"MONEY_PLAID_REDIRECT_URI":      "https://close.example/api/v1/bank-connections/callback",
		"MONEY_PLAID_WEBHOOK_URL":       "https://hooks.example/webhooks/plaid",
		"MONEY_PLAID_OPTIONAL_PRODUCTS": "transactions,liabilities",
		"MONEY_WEBHOOK_ADDR":            "127.0.0.1:0",
		"MONEY_ENV":                     "local",
		"MONEY_LISTEN_ADDR":             "127.0.0.1:0",
		"MONEY_HEALTH_ADDR":             "127.0.0.1:0",
		"MONEY_DATABASE_URL":            e2eURL,
		"MONEY_MIGRATE_ON_START":        "true",
		"MONEY_TLS_CERT_FILE":           write("server.pem", server.CertPEM, 0o600),
		"MONEY_TLS_KEY_FILE":            write("server-key.pem", server.KeyPEM, 0o600),
		"MONEY_TLS_CLIENT_CA_FILE":      write("ca.pem", ca.CertPEM, 0o600),
		"MONEY_TLS_ALLOWED_CLIENTS":     "spiffe://sagolik/web",
		"MONEY_LOCAL_KEYRING_FILE":      write("keyring.json", keyring, 0o600),
		"MONEY_ASSERTION_JWKS_FILE":     write("jwks.json", []byte(jwks), 0o644),
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

	token := func(role string) string { return tokenFor("4a6a4324-5fc8-4baa-a828-14210de77d3c", role, false) }
	_ = token
	tokenFor = func(user, role string, stepUp bool) string {
		enc := func(v any) string { b, _ := json.Marshal(v); return base64.RawURLEncoding.EncodeToString(b) }
		jti := make([]byte, 16)
		_, _ = rand.Read(jti)
		now := time.Now().Unix()
		in := enc(map[string]any{"alg": "EdDSA", "typ": "JWT", "kid": "web-1"}) + "." + enc(map[string]any{
			"iss": "sagolik-web", "aud": "sagolik-money", "sub": user,
			"txn": "a8db1096-1336-4467-8fd9-6415bd8939c0", "role": role, "aal": "aal2", "iat": now, "exp": now + 60,
			"jti": base64.RawURLEncoding.EncodeToString(jti), "step_up_at": map[bool]any{true: now - 30, false: nil}[stepUp]})
		return in + "." + base64.RawURLEncoding.EncodeToString(ed25519.Sign(priv, []byte(in)))
	}
	post := func(path, tok, body string) (int, map[string]any) {
		req, _ := http.NewRequest("POST", "https://"+addr.API+path, strings.NewReader(body))
		req.Header.Set("Authorization", "Bearer "+tok)
		req.Header.Set("Content-Type", "application/json")
		res, err := client.Do(req)
		if err != nil {
			t.Fatal(err)
		}
		defer res.Body.Close()
		var out map[string]any
		b, _ := io.ReadAll(res.Body)
		_ = json.Unmarshal(b, &out)
		return res.StatusCode, out
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
	// ---- M2: payment instructions and escrow-reported movements
	const (
		escrow = "43964358-5d5f-4521-a52c-63562021c400"
		title  = "11111111-1111-4111-8111-111111111111"
		buyer  = "4a6a4324-5fc8-4baa-a828-14210de77d3c"
		txPath = "/v1/transactions/a8db1096-1336-4467-8fd9-6415bd8939c0"
	)
	instr := `{"purpose":"closing_funds_to_escrow","beneficiaryName":"Maple Title & Escrow — Trust Account","bankName":"Sandbox National Bank","routingNumber":"021000021","accountNumber":"0001 2345 6789","currency":"USD"}`
	if code, body := post(txPath+"/instructions", tokenFor(escrow, "escrow_officer", false), instr); code != 403 || body["error"].(map[string]any)["code"] != "step_up_required" {
		t.Fatalf("create without step-up: %d %v", code, body)
	}
	if code, _ := post(txPath+"/instructions", tokenFor(buyer, "buyer", true), instr); code != 404 {
		t.Fatalf("buyer must not create instructions: %d", code)
	}
	code, body = post(txPath+"/instructions", tokenFor(escrow, "escrow_officer", true), instr)
	if code != 201 {
		t.Fatalf("create: %d %v", code, body)
	}
	ins := body["instruction"].(map[string]any)
	iid := ins["id"].(string)
	if ins["accountMask"] != "6789" || ins["status"] != "pending_verification" || strings.Contains(fmt.Sprint(body), "000123456789") {
		t.Fatalf("created: %v", ins)
	}
	verify := `{"method":"out_of_band_call","reference":"Called escrow on the number on file"}`
	if code, _ := post("/v1/instructions/"+iid+"/verify", tokenFor(escrow, "escrow_officer", true), verify); code != 403 {
		t.Fatalf("author must not verify: %d", code)
	}
	if code, body := post("/v1/instructions/"+iid+"/reveal", tokenFor(buyer, "buyer", true), `{}`); code != 409 {
		t.Fatalf("reveal before verification: %d %v", code, body)
	}
	if code, body := post("/v1/instructions/"+iid+"/verify", tokenFor(title, "title_officer", true), verify); code != 200 || body["instruction"].(map[string]any)["status"] != "verified" {
		t.Fatalf("verify: %d %v", code, body)
	}
	if code, _ := post("/v1/instructions/"+iid+"/reveal", tokenFor(buyer, "buyer_agent", true), `{}`); code != 404 {
		t.Fatalf("agent must not see wire details: %d", code)
	}
	if code, body := post("/v1/instructions/"+iid+"/reveal", tokenFor(buyer, "buyer", true), `{}`); code != 200 || body["accountNumber"] != "000123456789" {
		t.Fatalf("reveal: %d %v", code, body)
	}
	receipt := `{"kind":"receipt","amount":17500000,"currency":"USD","reference":"Wire ref FW-20260924-001","idempotencyKey":"escrow-receipt-closing-1"}`
	if code, body := post(txPath+"/ledger/movements", tokenFor(escrow, "escrow_officer", true), receipt); code != 201 || body["balances"].([]any)[0].(map[string]any)["outstanding"].(float64) != 0 {
		t.Fatalf("record receipt: %d %v", code, body)
	}
	if code, _ := post(txPath+"/ledger/movements", tokenFor(escrow, "escrow_officer", true), receipt); code != 200 {
		t.Fatalf("idempotent replay: %d", code)
	}
	if code, _ := post(txPath+"/ledger/movements", tokenFor(title, "title_officer", true), receipt); code != 404 {
		t.Fatalf("title officer can't record escrow movements: %d", code)
	}

	// ---- M3: bank connections through Plaid Hosted Link (stand-in Plaid)
	const seller = "22222222-2222-4222-8222-222222222222"
	if code, _ := post(txPath+"/bank-links", tokenFor(buyer, "buyer_agent", false), `{}`); code != 404 {
		t.Fatalf("agent must not start a bank link: %d", code)
	}
	code, body = post(txPath+"/bank-links", tokenFor(buyer, "buyer", false), `{"legalName":"Olivia Carter"}`)
	if code != 201 || !strings.HasPrefix(fmt.Sprint(body["hostedLinkUrl"]), "https://") {
		t.Fatalf("start link: %d %v", code, body)
	}
	linkID := body["linkId"].(string)
	complete := `{"legalName":"Olivia Carter"}`
	if code, body := post("/v1/bank-links/"+linkID+"/complete", tokenFor(buyer, "buyer", false), complete); code != 409 || body["error"].(map[string]any)["code"] != "link_not_finished" {
		t.Fatalf("complete before finishing: %d %v", code, body)
	}
	if !fake.FinishLink(fake.LastLinkToken()) {
		t.Fatal("no link started at Plaid")
	}
	if code, _ := post("/v1/bank-links/"+linkID+"/complete", tokenFor(seller, "buyer", false), complete); code != 404 {
		t.Fatalf("someone else must not complete the link: %d", code)
	}
	code, body = post("/v1/bank-links/"+linkID+"/complete", tokenFor(buyer, "buyer", false), complete)
	if code != 201 {
		t.Fatalf("complete: %d %v", code, body)
	}
	conn := body["connection"].(map[string]any)
	connID := conn["id"].(string)
	accts := conn["accounts"].([]any)
	checking := accts[0].(map[string]any)
	if conn["status"] != "connected" || len(accts) != 2 || checking["ownershipMatched"] != true || checking["mask"] != "0000" {
		t.Fatalf("connection: %v", conn)
	}
	if strings.Contains(fmt.Sprint(conn["accounts"]), "3333") {
		t.Fatalf("credit accounts must not be kept (their available amount is a credit limit): %v", conn["accounts"])
	}
	if strings.Contains(fmt.Sprint(body), "access-sandbox") || strings.Contains(fmt.Sprint(body), "item-") {
		t.Fatalf("token or item id leaked: %v", body)
	}
	if code, body := post("/v1/bank-links/"+linkID+"/complete", tokenFor(buyer, "buyer", false), complete); code != 200 || body["connection"].(map[string]any)["id"] != connID {
		t.Fatalf("completing again must return the same connection: %d %v", code, body)
	}
	if code, body := get(txPath+"/bank-connections", tokenFor(buyer, "buyer", false)); code != 200 || len(body["connections"].([]any)) != 1 {
		t.Fatalf("list: %d %v", code, body)
	}
	if code, body := get(txPath+"/bank-connections", tokenFor(seller, "co_buyer", false)); code != 200 || len(body["connections"].([]any)) != 0 {
		t.Fatalf("another payer must not see this connection: %d %v", code, body)
	}
	pof := "/v1/bank-connections/" + connID + "/accounts/" + checking["id"].(string) + "/proof-of-funds"
	code, body = post(pof, tokenFor(buyer, "buyer", false), `{"requiredAmount":17500000,"currency":"USD"}`)
	if code != 201 || body["fundsCheck"].(map[string]any)["sufficient"] != true || body["fundsCheck"].(map[string]any)["available"].(float64) != 25_000_000 {
		t.Fatalf("proof of funds: %d %v", code, body)
	}
	if code, _ := post(pof, tokenFor(seller, "co_buyer", false), `{"requiredAmount":1,"currency":"USD"}`); code != 404 {
		t.Fatalf("someone else must not check this account: %d", code)
	}
	code, body = get(txPath+"/funds", tokenFor(escrow, "escrow_officer", false))
	proof := body["proofOfFunds"].([]any)
	if code != 200 || len(proof) != 1 || proof[0].(map[string]any)["sufficient"] != true || proof[0].(map[string]any)["available"] != nil {
		t.Fatalf("escrow sees the result, never the balance: %d %v", code, body)
	}
	if strings.Contains(fmt.Sprint(body), "25000000") {
		t.Fatalf("balance leaked to escrow: %v", body)
	}

	// Bank activity (opt-in products): cash accounts only, money out is negative.
	code, body = get("/v1/bank-connections/"+connID+"/transactions?days=90", tokenFor(buyer, "buyer", false))
	txns, _ := body["transactions"].([]any)
	if code != 200 || len(txns) != 2 {
		t.Fatalf("transactions: %d %v", code, body)
	}
	first := txns[0].(map[string]any)
	if first["accountId"] != checking["id"] || first["amount"].(float64) != -45_000 || first["description"] != "HIGH COUNTRY SERVICES" {
		t.Fatalf("transaction: %v", first)
	}
	if txns[1].(map[string]any)["amount"].(float64) != 320_050 {
		t.Fatalf("money in is positive: %v", txns[1])
	}
	if code, _ := get("/v1/bank-connections/"+connID+"/transactions", tokenFor(seller, "co_buyer", false)); code != 404 {
		t.Fatalf("someone else must not read transactions: %d", code)
	}
	code, body = get("/v1/bank-connections/"+connID+"/mortgages", tokenFor(buyer, "buyer", false))
	ms, _ := body["mortgages"].([]any)
	if code != 200 || len(ms) != 1 || ms[0].(map[string]any)["nextMonthlyPayment"].(float64) != 298_000 || ms[0].(map[string]any)["escrowBalance"].(float64) != 421_050 {
		t.Fatalf("mortgages: %d %v", code, body)
	}

	// Plaid webhooks: signature-checked, stored once, status follows.
	var itemID string
	if err := admin2(t, ctx, e2eURL).QueryRow(ctx, `select item_id from bank_connections where id = $1`, connID).Scan(&itemID); err != nil {
		t.Fatal(err)
	}
	hook := func(body []byte, sig string) (int, map[string]any) {
		req, _ := http.NewRequest("POST", "http://"+addr.Webhook+"/webhooks/plaid", bytes.NewReader(body))
		req.Header.Set("Plaid-Verification", sig)
		req.Header.Set("Content-Type", "application/json")
		res, err := http.DefaultClient.Do(req)
		if err != nil {
			t.Fatal(err)
		}
		defer res.Body.Close()
		var out map[string]any
		_ = json.NewDecoder(res.Body).Decode(&out)
		return res.StatusCode, out
	}
	loginRequired := []byte(`{"webhook_type":"ITEM","webhook_code":"ERROR","item_id":"` + itemID + `","error":{"error_code":"ITEM_LOGIN_REQUIRED"},"environment":"sandbox"}`)
	if code, _ := hook(loginRequired, "not-a-jwt"); code != 401 {
		t.Fatalf("unsigned webhook: %d", code)
	}
	if code, _ := hook(loginRequired, fake.Sign([]byte(`{}`), time.Now())); code != 401 {
		t.Fatalf("signature over another body: %d", code)
	}
	if code, body := hook(loginRequired, fake.Sign(loginRequired, time.Now())); code != 200 || body["status"] != "processed" {
		t.Fatalf("webhook: %d %v", code, body)
	}
	if code, body := hook(loginRequired, fake.Sign(loginRequired, time.Now())); code != 200 || body["status"] != "duplicate" {
		t.Fatalf("duplicate webhook: %d %v", code, body)
	}
	if _, body := get(txPath+"/bank-connections", tokenFor(buyer, "buyer", false)); body["connections"].([]any)[0].(map[string]any)["status"] != "reauthentication_required" {
		t.Fatalf("status after webhook: %v", body)
	}
	if code, _ := hook([]byte(`{"webhook_type":"ITEM","webhook_code":"LOGIN_REPAIRED","item_id":"`+itemID+`","environment":"production"}`),
		fake.Sign([]byte(`{"webhook_type":"ITEM","webhook_code":"LOGIN_REPAIRED","item_id":"`+itemID+`","environment":"production"}`), time.Now())); code != 200 {
		t.Fatalf("other environment: %d", code)
	}
	if _, body := get(txPath+"/bank-connections", tokenFor(buyer, "buyer", false)); body["connections"].([]any)[0].(map[string]any)["status"] != "reauthentication_required" {
		t.Fatal("a webhook for another Plaid environment must not change status")
	}

	// Disconnecting needs step-up, revokes at Plaid and destroys the token.
	if code, _ := post("/v1/bank-connections/"+connID+"/disconnect", tokenFor(buyer, "buyer", false), `{}`); code != 403 {
		t.Fatalf("disconnect without step-up: %d", code)
	}
	if code, body := post("/v1/bank-connections/"+connID+"/disconnect", tokenFor(buyer, "buyer", true), `{}`); code != 200 || body["connection"].(map[string]any)["status"] != "revoked" {
		t.Fatalf("disconnect: %d %v", code, body)
	}
	if !fake.ItemRemoved(itemID) {
		t.Fatal("item not removed at Plaid")
	}
	if code, _ := post(pof, tokenFor(buyer, "buyer", false), `{"requiredAmount":1,"currency":"USD"}`); code != 409 {
		t.Fatalf("proof of funds after disconnect: %d", code)
	}

	// Everything above is in the audit chain, and it verifies.
	var actions []string
	rows, _ := admin2(t, ctx, e2eURL).Query(ctx, `select action from audit_events order by seq`)
	for rows.Next() {
		var a string
		_ = rows.Scan(&a)
		actions = append(actions, a)
	}
	for _, want := range []string{"funds.viewed", "instruction.created", "instruction.verified", "instruction.revealed", "ledger.recorded",
		"bank.link_started", "bank.connected", "bank.funds_checked", "bank.status_changed", "bank.disconnected"} {
		if !slices.Contains(actions, want) {
			t.Fatalf("audit missing %s: %v", want, actions)
		}
	}
	if _, err := st.VerifyAuditChain(ctx); err != nil {
		t.Fatalf("audit chain: %v", err)
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
	if strings.Contains(logs.String(), "a8db1096") || strings.Contains(logs.String(), e2eURL) ||
		strings.Contains(logs.String(), "access-sandbox") || strings.Contains(logs.String(), "link-sandbox") || strings.Contains(logs.String(), plaidtest.Secret) {
		t.Fatal("logs must not contain transaction ids or the database url")
	}
}

func admin2(t *testing.T, ctx context.Context, url string) *pgx.Conn {
	t.Helper()
	c, err := pgx.Connect(ctx, url)
	if err != nil {
		t.Fatal(err)
	}
	t.Cleanup(func() { _ = c.Close(context.Background()) })
	return c
}
