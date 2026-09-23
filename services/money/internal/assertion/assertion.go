// Package assertion verifies the short-lived user assertions the web app
// attaches to every call: a compact JWS signed with Ed25519 (alg "EdDSA").
//
// The verifier is deliberately narrow — one algorithm, strict decoding,
// bounded lifetime, single use — because a bug here would let someone act as
// another user on money endpoints.
package assertion

import (
	"bytes"
	"context"
	"crypto/ed25519"
	"encoding/base64"
	"encoding/json"
	"errors"
	"fmt"
	"regexp"
	"strings"
	"time"
)

const (
	// MaxLifetime is the longest validity window (exp - iat) we accept.
	MaxLifetime = 60 * time.Second
	// ClockSkew tolerated between the web app and this service.
	ClockSkew   = 5 * time.Second
	maxTokenLen = 4096
)

// Claims carried by an assertion.
type Claims struct {
	Issuer        string `json:"iss"`
	Audience      string `json:"aud"`
	Subject       string `json:"sub"`           // user id
	TransactionID string `json:"txn,omitempty"` // transaction the request is scoped to
	Role          string `json:"role,omitempty"`
	AAL           string `json:"aal"`                  // "aal1" | "aal2"
	StepUpAt      int64  `json:"step_up_at,omitempty"` // unix seconds of the last step-up
	IssuedAt      int64  `json:"iat"`
	ExpiresAt     int64  `json:"exp"`
	ID            string `json:"jti"`
}

// Principal is a verified caller.
type Principal struct {
	UserID        string
	TransactionID string
	Role          string
	AAL2          bool
	StepUpAt      time.Time // zero if none
}

// StepUpFresh reports whether the caller confirmed it's them within maxAge.
func (p Principal) StepUpFresh(now time.Time, maxAge time.Duration) bool {
	return !p.StepUpAt.IsZero() && !p.StepUpAt.After(now.Add(ClockSkew)) && now.Sub(p.StepUpAt) <= maxAge
}

// ErrInvalid is returned for every rejected assertion; Reason carries detail for logs only.
var ErrInvalid = errors.New("assertion: invalid")

type Error struct{ Reason string }

func (e *Error) Error() string        { return "assertion: invalid: " + e.Reason }
func (e *Error) Is(target error) bool { return target == ErrInvalid }

func invalid(format string, a ...any) error { return &Error{Reason: fmt.Sprintf(format, a...)} }

// ReplayGuard records assertion ids and reports reuse.
type ReplayGuard interface {
	// Use marks id as used until expiry; it returns false if id was already used.
	Use(ctx context.Context, id string, expiry time.Time) (bool, error)
}

// Verifier checks assertions against a key set.
type Verifier struct {
	Keys     *KeySet
	Issuer   string
	Audience string
	Replay   ReplayGuard
	Now      func() time.Time
}

var (
	uuidRe = regexp.MustCompile(`^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$`)
	jtiRe  = regexp.MustCompile(`^[A-Za-z0-9_-]{16,128}$`)
	roleRe = regexp.MustCompile(`^[a-z_]{1,64}$`)
)

type header struct {
	Alg string `json:"alg"`
	Typ string `json:"typ"`
	Kid string `json:"kid"`
}

// Verify validates token and returns the caller.
func (v *Verifier) Verify(ctx context.Context, token string) (Principal, error) {
	now := time.Now()
	if v.Now != nil {
		now = v.Now()
	}
	if len(token) == 0 || len(token) > maxTokenLen {
		return Principal{}, invalid("length")
	}
	parts := strings.Split(token, ".")
	if len(parts) != 3 {
		return Principal{}, invalid("not a compact JWS")
	}
	var h header
	if err := decodeSegment(parts[0], &h); err != nil {
		return Principal{}, invalid("header: %v", err)
	}
	// Algorithm pinning: only EdDSA, never "none", never an HMAC confusion.
	if h.Alg != "EdDSA" || h.Typ != "JWT" {
		return Principal{}, invalid("unsupported alg/typ %q/%q", h.Alg, h.Typ)
	}
	pub, ok := v.Keys.Get(h.Kid)
	if !ok {
		return Principal{}, invalid("unknown kid %q", h.Kid)
	}
	sig, err := base64.RawURLEncoding.Strict().DecodeString(parts[2])
	if err != nil || len(sig) != ed25519.SignatureSize {
		return Principal{}, invalid("signature encoding")
	}
	if !ed25519.Verify(pub, []byte(parts[0]+"."+parts[1]), sig) {
		return Principal{}, invalid("bad signature")
	}
	var c Claims
	if err := decodeSegment(parts[1], &c); err != nil {
		return Principal{}, invalid("claims: %v", err)
	}
	if c.Issuer != v.Issuer || c.Audience != v.Audience {
		return Principal{}, invalid("issuer/audience")
	}
	if !uuidRe.MatchString(c.Subject) {
		return Principal{}, invalid("subject")
	}
	if c.TransactionID != "" && !uuidRe.MatchString(c.TransactionID) {
		return Principal{}, invalid("transaction id")
	}
	if c.Role != "" && !roleRe.MatchString(c.Role) {
		return Principal{}, invalid("role")
	}
	if c.AAL != "aal1" && c.AAL != "aal2" {
		return Principal{}, invalid("aal")
	}
	if !jtiRe.MatchString(c.ID) {
		return Principal{}, invalid("jti")
	}
	iat, exp := time.Unix(c.IssuedAt, 0), time.Unix(c.ExpiresAt, 0)
	switch {
	case c.IssuedAt == 0 || c.ExpiresAt == 0:
		return Principal{}, invalid("missing iat/exp")
	case !exp.After(iat) || exp.Sub(iat) > MaxLifetime:
		return Principal{}, invalid("lifetime")
	case iat.After(now.Add(ClockSkew)):
		return Principal{}, invalid("issued in the future")
	case !now.Before(exp.Add(ClockSkew)):
		return Principal{}, invalid("expired")
	}
	var stepUp time.Time
	if c.StepUpAt != 0 {
		stepUp = time.Unix(c.StepUpAt, 0)
		if stepUp.After(iat.Add(ClockSkew)) {
			return Principal{}, invalid("step-up after issue time")
		}
	}
	if v.Replay == nil {
		return Principal{}, errors.New("assertion: no replay guard configured")
	}
	fresh, err := v.Replay.Use(ctx, c.ID, exp.Add(ClockSkew))
	if err != nil {
		return Principal{}, fmt.Errorf("assertion: replay guard: %w", err)
	}
	if !fresh {
		return Principal{}, invalid("replayed")
	}
	return Principal{UserID: c.Subject, TransactionID: c.TransactionID, Role: c.Role, AAL2: c.AAL == "aal2", StepUpAt: stepUp}, nil
}

// decodeSegment strictly decodes a base64url JSON segment: no padding, no
// unknown fields, no duplicate trailing data.
func decodeSegment(seg string, into any) error {
	raw, err := base64.RawURLEncoding.Strict().DecodeString(seg)
	if err != nil {
		return err
	}
	dec := json.NewDecoder(bytes.NewReader(raw))
	dec.DisallowUnknownFields()
	if err := dec.Decode(into); err != nil {
		return err
	}
	if dec.More() {
		return errors.New("trailing data")
	}
	return nil
}
