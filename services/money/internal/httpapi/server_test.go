package httpapi

import (
	"bytes"
	"context"
	"crypto/ed25519"
	"crypto/rand"
	"encoding/base64"
	"encoding/json"
	"errors"
	"io"
	"log/slog"
	"net/http"
	"net/http/httptest"
	"strings"
	"sync"
	"testing"
	"time"

	"github.com/quantitynetwork/sagolik-close/services/money/internal/assertion"
	"github.com/quantitynetwork/sagolik-close/services/money/internal/keys"
	"github.com/quantitynetwork/sagolik-close/services/money/internal/store"
)

const (
	userID = "4a6a4324-5fc8-4baa-a828-14210de77d3c"
	txID   = "a8db1096-1336-4467-8fd9-6415bd8939c0"
)

// ---- test signing (mirrors packages/security signUserAssertion)

type signer struct{ key ed25519.PrivateKey }

func newSigner() signer {
	_, k, _ := ed25519.GenerateKey(rand.Reader)
	return signer{key: k}
}

func (s signer) jwks() []byte {
	x := base64.RawURLEncoding.EncodeToString(s.key.Public().(ed25519.PublicKey))
	return []byte(`{"keys":[{"kty":"OKP","crv":"Ed25519","kid":"web-1","x":"` + x + `","use":"sig","alg":"EdDSA"}]}`)
}

func (s signer) token(claims map[string]any) string {
	enc := func(v any) string { b, _ := json.Marshal(v); return base64.RawURLEncoding.EncodeToString(b) }
	in := enc(map[string]any{"alg": "EdDSA", "typ": "JWT", "kid": "web-1"}) + "." + enc(claims)
	return in + "." + base64.RawURLEncoding.EncodeToString(ed25519.Sign(s.key, []byte(in)))
}

func claims(role string, extra map[string]any) map[string]any {
	now := time.Now().Unix()
	jti := make([]byte, 16)
	_, _ = rand.Read(jti)
	c := map[string]any{"iss": "sagolik-web", "aud": "sagolik-money", "sub": userID, "txn": txID, "role": role, "aal": "aal2",
		"iat": now, "exp": now + 60, "jti": base64.RawURLEncoding.EncodeToString(jti)}
	for k, v := range extra {
		c[k] = v
	}
	return c
}

// ---- fakes

type fakeStore struct {
	mu       sync.Mutex
	pingErr  error
	audit    []store.AuditEvent
	auditErr error
}

func (f *fakeStore) Ping(context.Context) error { return f.pingErr }
func (f *fakeStore) FundsSummary(context.Context, string) ([]store.Summary, error) {
	return []store.Summary{{Currency: "USD", Expected: 20_000_000, Outstanding: 5_000_000, Received: 15_000_000}}, nil
}
func (f *fakeStore) AppendAudit(_ context.Context, e store.AuditEvent) (store.AuditEvent, error) {
	f.mu.Lock()
	defer f.mu.Unlock()
	if f.auditErr != nil {
		return e, f.auditErr
	}
	f.audit = append(f.audit, e)
	return e, nil
}

type brokenSealer struct{}

func (brokenSealer) Seal(context.Context, []byte, keys.Context) (string, error) {
	return "", errors.New("kms down")
}
func (brokenSealer) Open(context.Context, string, keys.Context) ([]byte, error) {
	return nil, errors.New("kms down")
}

func newServer(t *testing.T, st Store, sealer Sealer, sg signer, logs *bytes.Buffer) *Server {
	t.Helper()
	ks, err := assertion.ParseJWKS(sg.jwks())
	if err != nil {
		t.Fatal(err)
	}
	if sealer == nil {
		doc, _ := keys.NewKeyringDocument("v1")
		p, _ := keys.ParseKeyring(doc)
		sealer = keys.NewEnvelope(p)
	}
	w := io.Writer(io.Discard)
	if logs != nil {
		w = logs
	}
	return &Server{
		Verifier: &assertion.Verifier{Keys: ks, Issuer: "sagolik-web", Audience: "sagolik-money", Replay: assertion.NewMemoryReplayGuard()},
		Store:    st, Sealer: sealer, Log: slog.New(slog.NewJSONHandler(w, nil)),
	}
}

func do(h http.Handler, method, path, token string) (*httptest.ResponseRecorder, map[string]any) {
	req := httptest.NewRequest(method, path, nil)
	if token != "" {
		req.Header.Set("Authorization", "Bearer "+token)
	}
	rec := httptest.NewRecorder()
	h.ServeHTTP(rec, req)
	var body map[string]any
	_ = json.Unmarshal(rec.Body.Bytes(), &body)
	return rec, body
}

func TestSessionAndFunds(t *testing.T) {
	sg, st := newSigner(), &fakeStore{}
	var logs bytes.Buffer
	h := newServer(t, st, nil, sg, &logs).APIHandler()

	rec, body := do(h, "GET", "/v1/session", sg.token(claims("buyer", map[string]any{"step_up_at": time.Now().Add(-30 * time.Second).Unix()})))
	if rec.Code != 200 || body["userId"] != userID || body["aal"] != "aal2" || body["role"] != "buyer" {
		t.Fatalf("session: %d %v", rec.Code, body)
	}
	if rec.Header().Get("Cache-Control") != "no-store" || rec.Header().Get("X-Request-Id") == "" {
		t.Fatal("missing security headers")
	}

	rec, body = do(h, "GET", "/v1/transactions/"+txID+"/funds", sg.token(claims("buyer", nil)))
	if rec.Code != 200 {
		t.Fatalf("funds: %d %v", rec.Code, body)
	}
	if len(st.audit) != 1 || st.audit[0].Action != "funds.viewed" || st.audit[0].Actor != "user:"+userID {
		t.Fatalf("funds read must be audited: %+v", st.audit)
	}
	if strings.Contains(logs.String(), txID) {
		t.Fatal("access log must not contain ids from the path")
	}
}

func TestFundsAccessRules(t *testing.T) {
	sg := newSigner()
	h := newServer(t, &fakeStore{}, nil, sg, nil).APIHandler()
	other := "11111111-1111-4111-8111-111111111111"
	for name, tc := range map[string]struct {
		path  string
		token string
	}{
		"agent role (no financial.view)": {"/v1/transactions/" + txID + "/funds", sg.token(claims("buyer_agent", nil))},
		"assertion for another tx":       {"/v1/transactions/" + other + "/funds", sg.token(claims("buyer", nil))},
		"assertion without tx":           {"/v1/transactions/" + txID + "/funds", sg.token(claims("buyer", map[string]any{"txn": nil}))},
		"malformed id":                   {"/v1/transactions/not-a-uuid/funds", sg.token(claims("buyer", nil))},
	} {
		c := tc
		if strings.Contains(name, "without tx") {
			m := claims("buyer", nil)
			delete(m, "txn")
			c.token = sg.token(m)
		}
		rec, body := do(h, "GET", c.path, c.token)
		if rec.Code != 404 || body["error"].(map[string]any)["code"] != "not_found" {
			t.Errorf("%s: got %d %v", name, rec.Code, body)
		}
	}
}

func TestAuthenticationFailures(t *testing.T) {
	sg := newSigner()
	h := newServer(t, &fakeStore{}, nil, sg, nil).APIHandler()
	good := sg.token(claims("buyer", nil))
	if rec, _ := do(h, "GET", "/v1/session", ""); rec.Code != 401 {
		t.Fatalf("missing token: %d", rec.Code)
	}
	if rec, _ := do(h, "GET", "/v1/session", newSigner().token(claims("buyer", nil))); rec.Code != 401 {
		t.Fatalf("foreign signer: %d", rec.Code)
	}
	if rec, _ := do(h, "GET", "/v1/session", good); rec.Code != 200 {
		t.Fatalf("good: %d", rec.Code)
	}
	if rec, _ := do(h, "GET", "/v1/session", good); rec.Code != 401 {
		t.Fatalf("replayed token must be refused: %d", rec.Code)
	}
	if rec, _ := do(h, "POST", "/v1/session", good); rec.Code != 405 && rec.Code != 404 {
		t.Fatalf("wrong method: %d", rec.Code)
	}
	if rec, body := do(h, "GET", "/v2/whatever", good); rec.Code != 404 || body["error"] == nil {
		t.Fatalf("unknown route: %d", rec.Code)
	}
}

func TestNoAuditNoData(t *testing.T) {
	sg := newSigner()
	h := newServer(t, &fakeStore{auditErr: errors.New("db down")}, nil, sg, nil).APIHandler()
	rec, body := do(h, "GET", "/v1/transactions/"+txID+"/funds", sg.token(claims("buyer", nil)))
	if rec.Code != 500 || body["balances"] != nil {
		t.Fatalf("funds must not be returned without an audit record: %d %v", rec.Code, body)
	}
}

func TestReadiness(t *testing.T) {
	sg := newSigner()
	h := newServer(t, &fakeStore{}, nil, sg, nil).HealthHandler()
	if rec, body := do(h, "GET", "/readyz", ""); rec.Code != 200 || body["status"] != "ready" {
		t.Fatalf("ready: %d %v", rec.Code, body)
	}
	h = newServer(t, &fakeStore{pingErr: errors.New("down")}, brokenSealer{}, sg, nil).HealthHandler()
	rec, body := do(h, "GET", "/readyz", "")
	if rec.Code != 503 || body["checks"].(map[string]any)["database"] != "unavailable" || body["checks"].(map[string]any)["keys"] != "unavailable" {
		t.Fatalf("not ready: %d %v", rec.Code, body)
	}
	if rec, _ := do(h, "GET", "/healthz", ""); rec.Code != 200 {
		t.Fatal("liveness must not depend on dependencies")
	}
}
