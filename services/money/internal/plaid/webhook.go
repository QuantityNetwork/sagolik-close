package plaid

import (
	"context"
	"crypto/ecdsa"
	"crypto/elliptic"
	"crypto/sha256"
	"crypto/subtle"
	"encoding/base64"
	"encoding/hex"
	"encoding/json"
	"errors"
	"math/big"
	"regexp"
	"strings"
	"sync"
	"time"
)

// JWK is a Plaid webhook verification key.
type JWK struct {
	Alg       string `json:"alg"`
	Crv       string `json:"crv"`
	Kid       string `json:"kid"`
	Kty       string `json:"kty"`
	Use       string `json:"use"`
	X         string `json:"x"`
	Y         string `json:"y"`
	CreatedAt int64  `json:"created_at"`
	ExpiredAt *int64 `json:"expired_at"`
}

// WebhookKey fetches a verification key by id (/webhook_verification_key/get).
func (c *Client) WebhookKey(ctx context.Context, kid string) (JWK, error) {
	var out struct {
		Key JWK `json:"key"`
	}
	if err := c.call(ctx, "/webhook_verification_key/get", map[string]any{"key_id": kid}, &out); err != nil {
		return JWK{}, err
	}
	return out.Key, nil
}

// KeySource is where verification keys come from (the Plaid client).
type KeySource interface {
	WebhookKey(ctx context.Context, kid string) (JWK, error)
}

// ErrWebhookRejected: the webhook isn't provably from Plaid. Details stay in logs.
type ErrWebhookRejected struct{ Reason string }

func (e *ErrWebhookRejected) Error() string { return "plaid webhook rejected: " + e.Reason }

func reject(reason string) error { return &ErrWebhookRejected{Reason: reason} }

// MaxWebhookAge is Plaid's documented limit on the JWT's iat.
const MaxWebhookAge = 5 * time.Minute

// WebhookVerifier checks the Plaid-Verification JWT: ES256 signature by a
// current Plaid key, issued within five minutes, and a SHA-256 of the exact body.
type WebhookVerifier struct {
	Keys KeySource
	Now  func() time.Time

	mu      sync.Mutex
	cache   map[string]cachedKey
	fetched map[string]time.Time // last fetch per kid, so unknown kids can't make us hammer Plaid
}

type cachedKey struct {
	pub     *ecdsa.PublicKey
	expired *time.Time
}

var kidRe = regexp.MustCompile(`^[A-Za-z0-9-]{8,64}$`)

func (v *WebhookVerifier) now() time.Time {
	if v.Now != nil {
		return v.Now()
	}
	return time.Now()
}

// Verify returns nil only for an authentic, fresh webhook body.
func (v *WebhookVerifier) Verify(ctx context.Context, token string, body []byte) error {
	parts := strings.Split(token, ".")
	if len(parts) != 3 {
		return reject("malformed token")
	}
	var header struct {
		Alg string `json:"alg"`
		Kid string `json:"kid"`
	}
	if err := decodeSegment(parts[0], &header); err != nil {
		return reject("malformed header")
	}
	// Pin the algorithm: never let the token choose it.
	if header.Alg != "ES256" {
		return reject("unexpected alg")
	}
	if !kidRe.MatchString(header.Kid) {
		return reject("malformed kid")
	}
	key, err := v.key(ctx, header.Kid)
	if err != nil {
		return err
	}
	if key.expired != nil && !v.now().Before(*key.expired) {
		return reject("expired key")
	}
	sig, err := base64.RawURLEncoding.DecodeString(parts[2])
	if err != nil || len(sig) != 64 {
		return reject("malformed signature")
	}
	digest := sha256.Sum256([]byte(parts[0] + "." + parts[1]))
	r, s := new(big.Int).SetBytes(sig[:32]), new(big.Int).SetBytes(sig[32:])
	if !ecdsa.Verify(key.pub, digest[:], r, s) {
		return reject("bad signature")
	}
	var claims struct {
		Iat        *int64 `json:"iat"`
		BodySHA256 string `json:"request_body_sha256"`
	}
	if err := decodeSegment(parts[1], &claims); err != nil || claims.Iat == nil {
		return reject("malformed claims")
	}
	issued := time.Unix(*claims.Iat, 0)
	now := v.now()
	if now.Sub(issued) > MaxWebhookAge || issued.Sub(now) > time.Minute {
		return reject("stale or future iat")
	}
	sum := sha256.Sum256(body)
	want := hex.EncodeToString(sum[:])
	if subtle.ConstantTimeCompare([]byte(want), []byte(strings.ToLower(claims.BodySHA256))) != 1 {
		return reject("body hash mismatch")
	}
	return nil
}

func (v *WebhookVerifier) key(ctx context.Context, kid string) (cachedKey, error) {
	v.mu.Lock()
	if v.cache == nil {
		v.cache, v.fetched = map[string]cachedKey{}, map[string]time.Time{}
	}
	if k, ok := v.cache[kid]; ok {
		v.mu.Unlock()
		return k, nil
	}
	if last, ok := v.fetched[kid]; ok && v.now().Sub(last) < time.Minute {
		v.mu.Unlock()
		return cachedKey{}, reject("unknown kid")
	}
	if len(v.fetched) > 1000 { // bound memory under a flood of random kids
		v.fetched = map[string]time.Time{}
	}
	v.fetched[kid] = v.now()
	v.mu.Unlock()

	jwk, err := v.Keys.WebhookKey(ctx, kid)
	if err != nil {
		var pe *Error
		if errors.As(err, &pe) && pe.Status >= 400 && pe.Status < 500 {
			return cachedKey{}, reject("unknown kid")
		}
		return cachedKey{}, err // Plaid unreachable: the caller answers 5xx so Plaid retries
	}
	pub, err := jwk.publicKey()
	if err != nil || jwk.Kid != kid {
		return cachedKey{}, reject("unusable key")
	}
	k := cachedKey{pub: pub}
	if jwk.ExpiredAt != nil {
		t := time.Unix(*jwk.ExpiredAt, 0)
		k.expired = &t
	}
	v.mu.Lock()
	v.cache[kid] = k
	v.mu.Unlock()
	return k, nil
}

func (k JWK) publicKey() (*ecdsa.PublicKey, error) {
	if k.Kty != "EC" || k.Crv != "P-256" || (k.Alg != "" && k.Alg != "ES256") {
		return nil, errors.New("plaid: unsupported key")
	}
	xb, err1 := base64.RawURLEncoding.DecodeString(k.X)
	yb, err2 := base64.RawURLEncoding.DecodeString(k.Y)
	if err1 != nil || err2 != nil || len(xb) != 32 || len(yb) != 32 {
		return nil, errors.New("plaid: malformed key")
	}
	// Build the uncompressed point and let the stdlib check it is on the curve.
	point := append([]byte{4}, append(xb, yb...)...)
	pub, err := ecdsa.ParseUncompressedPublicKey(elliptic.P256(), point)
	if err != nil {
		return nil, err
	}
	return pub, nil
}

func decodeSegment(seg string, into any) error {
	b, err := base64.RawURLEncoding.DecodeString(seg)
	if err != nil {
		return err
	}
	return json.Unmarshal(b, into)
}

// Webhook is the part of a Plaid webhook body the service acts on.
type Webhook struct {
	Type        string `json:"webhook_type"`
	Code        string `json:"webhook_code"`
	ItemID      string `json:"item_id"`
	Environment string `json:"environment"`
	Error       *struct {
		ErrorCode string `json:"error_code"`
	} `json:"error"`
	ConsentExpirationTime *time.Time `json:"consent_expiration_time"`
}
