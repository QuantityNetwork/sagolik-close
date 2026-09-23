package assertion

import (
	"context"
	"crypto/ed25519"
	"encoding/base64"
	"encoding/json"
	"errors"
	"os"
	"strings"
	"testing"
	"time"
)

type vector struct {
	Now   time.Time       `json:"now"`
	JWKS  json.RawMessage `json:"jwks"`
	Token string          `json:"token"`
}

func loadVector(t *testing.T) vector {
	t.Helper()
	raw, err := os.ReadFile("testdata/web-vector.json")
	if err != nil {
		t.Fatal(err)
	}
	var v vector
	if err := json.Unmarshal(raw, &v); err != nil {
		t.Fatal(err)
	}
	return v
}

func verifierFor(t *testing.T, v vector) *Verifier {
	t.Helper()
	ks, err := ParseJWKS(v.JWKS)
	if err != nil {
		t.Fatal(err)
	}
	now := v.Now
	clock := func() time.Time { return now }
	guard := NewMemoryReplayGuard()
	guard.Now = clock // one clock for verifier and guard
	return &Verifier{Keys: ks, Issuer: "sagolik-web", Audience: "sagolik-money", Replay: guard, Now: clock}
}

// The token produced by the TypeScript signer (packages/security) verifies here.
func TestWebVectorVerifies(t *testing.T) {
	v := loadVector(t)
	p, err := verifierFor(t, v).Verify(context.Background(), v.Token)
	if err != nil {
		t.Fatal(err)
	}
	if p.UserID != "4a6a4324-5fc8-4baa-a828-14210de77d3c" || p.TransactionID != "a8db1096-1336-4467-8fd9-6415bd8939c0" || p.Role != "buyer" || !p.AAL2 {
		t.Fatalf("unexpected principal %+v", p)
	}
	if !p.StepUpFresh(v.Now, 5*time.Minute) || p.StepUpFresh(v.Now, time.Minute) {
		t.Fatal("step-up freshness wrong (step-up was 90s before now)")
	}
}

// Test-only key with the same seed as the TypeScript vector (0x00..0x1f).
func testKey() ed25519.PrivateKey {
	seed := make([]byte, 32)
	for i := range seed {
		seed[i] = byte(i)
	}
	return ed25519.NewKeyFromSeed(seed)
}

func b64(v any) string {
	raw, _ := json.Marshal(v)
	return base64.RawURLEncoding.EncodeToString(raw)
}

func sign(key ed25519.PrivateKey, hdr any, claims any) string {
	in := b64(hdr) + "." + b64(claims)
	return in + "." + base64.RawURLEncoding.EncodeToString(ed25519.Sign(key, []byte(in)))
}

func baseClaims(now time.Time) map[string]any {
	return map[string]any{
		"iss": "sagolik-web", "aud": "sagolik-money", "sub": "4a6a4324-5fc8-4baa-a828-14210de77d3c",
		"aal": "aal2", "iat": now.Unix(), "exp": now.Unix() + 60, "jti": "jti-abcdefghijklmnop",
	}
}

var goodHeader = map[string]any{"alg": "EdDSA", "typ": "JWT", "kid": "web-test-1"}

func TestRejections(t *testing.T) {
	v := loadVector(t)
	now := v.Now
	key := testKey()
	other := ed25519.NewKeyFromSeed(make([]byte, 32))
	with := func(k string, val any) map[string]any {
		c := baseClaims(now)
		if val == nil {
			delete(c, k)
		} else {
			c[k] = val
		}
		return c
	}
	good := sign(key, goodHeader, baseClaims(now))
	parts := strings.Split(good, ".")

	cases := map[string]string{
		"alg none":            b64(map[string]any{"alg": "none", "typ": "JWT", "kid": "web-test-1"}) + "." + parts[1] + ".",
		"alg HS256":           sign(key, map[string]any{"alg": "HS256", "typ": "JWT", "kid": "web-test-1"}, baseClaims(now)),
		"unknown kid":         sign(key, map[string]any{"alg": "EdDSA", "typ": "JWT", "kid": "nope"}, baseClaims(now)),
		"header extra field":  sign(key, map[string]any{"alg": "EdDSA", "typ": "JWT", "kid": "web-test-1", "jku": "https://evil"}, baseClaims(now)),
		"wrong signer":        sign(other, goodHeader, baseClaims(now)),
		"tampered claims":     parts[0] + "." + b64(with("sub", "00000000-0000-4000-8000-000000000000")) + "." + parts[2],
		"padded signature":    good + "==",
		"two segments":        parts[0] + "." + parts[1],
		"wrong audience":      sign(key, goodHeader, with("aud", "sagolik-web")),
		"wrong issuer":        sign(key, goodHeader, with("iss", "someone")),
		"expired":             sign(key, goodHeader, with("exp", now.Unix()-10)),
		"too long lived":      sign(key, goodHeader, with("exp", now.Unix()+3600)),
		"issued in future":    sign(key, goodHeader, map[string]any{"iss": "sagolik-web", "aud": "sagolik-money", "sub": "4a6a4324-5fc8-4baa-a828-14210de77d3c", "aal": "aal2", "iat": now.Unix() + 30, "exp": now.Unix() + 60, "jti": "jti-abcdefghijklmnop"}),
		"missing iat":         sign(key, goodHeader, with("iat", nil)),
		"subject not uuid":    sign(key, goodHeader, with("sub", "admin")),
		"bad aal":             sign(key, goodHeader, with("aal", "aal3")),
		"short jti":           sign(key, goodHeader, with("jti", "x")),
		"unknown claim":       sign(key, goodHeader, with("admin", true)),
		"step-up after issue": sign(key, goodHeader, with("step_up_at", now.Unix()+60)),
		"oversized":           strings.Repeat("a", 5000),
		"empty":               "",
	}
	for name, tok := range cases {
		t.Run(name, func(t *testing.T) {
			_, err := verifierFor(t, v).Verify(context.Background(), tok)
			if !errors.Is(err, ErrInvalid) {
				t.Fatalf("expected ErrInvalid, got %v", err)
			}
		})
	}
}

func TestReplayIsRejected(t *testing.T) {
	v := loadVector(t)
	ver := verifierFor(t, v)
	if _, err := ver.Verify(context.Background(), v.Token); err != nil {
		t.Fatal(err)
	}
	if _, err := ver.Verify(context.Background(), v.Token); !errors.Is(err, ErrInvalid) {
		t.Fatalf("second use must be rejected, got %v", err)
	}
}

func TestJWKSRejectsNonEd25519AndPrivateKeys(t *testing.T) {
	for name, doc := range map[string]string{
		"rsa":          `{"keys":[{"kty":"RSA","kid":"a","n":"x","e":"AQAB"}]}`,
		"private part": `{"keys":[{"kty":"OKP","crv":"Ed25519","kid":"a","x":"A6EHv_POEL4dcN0Y50vAmWfk1jCbpQ1fHdyGZBJVMbg","d":"secret"}]}`,
		"bad x":        `{"keys":[{"kty":"OKP","crv":"Ed25519","kid":"a","x":"AAAA"}]}`,
		"duplicate":    `{"keys":[{"kty":"OKP","crv":"Ed25519","kid":"a","x":"A6EHv_POEL4dcN0Y50vAmWfk1jCbpQ1fHdyGZBJVMbg"},{"kty":"OKP","crv":"Ed25519","kid":"a","x":"A6EHv_POEL4dcN0Y50vAmWfk1jCbpQ1fHdyGZBJVMbg"}]}`,
		"empty":        `{"keys":[]}`,
		"enc key":      `{"keys":[{"kty":"OKP","crv":"Ed25519","kid":"a","x":"A6EHv_POEL4dcN0Y50vAmWfk1jCbpQ1fHdyGZBJVMbg","use":"enc"}]}`,
	} {
		if _, err := ParseJWKS([]byte(doc)); err == nil {
			t.Errorf("%s: expected error", name)
		}
	}
}
