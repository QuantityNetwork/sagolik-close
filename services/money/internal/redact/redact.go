// Package redact provides types whose contents can never reach a log line,
// an error message or a JSON response by accident.
package redact

import (
	"fmt"
	"log/slog"
)

const mask = "[REDACTED]"

// Secret wraps sensitive text (tokens, account numbers). Formatting, logging
// and JSON encoding all yield "[REDACTED]"; call Reveal for the real value.
type Secret struct{ v string }

func NewSecret(v string) Secret { return Secret{v: v} }

// Reveal returns the underlying value. Every call site is a place where the
// secret leaves protection, so keep them few and obvious.
func (s Secret) Reveal() string { return s.v }

func (s Secret) IsZero() bool               { return s.v == "" }
func (Secret) String() string               { return mask }
func (Secret) GoString() string             { return mask }
func (Secret) LogValue() slog.Value         { return slog.StringValue(mask) }
func (Secret) MarshalJSON() ([]byte, error) { return []byte(`"` + mask + `"`), nil }
func (Secret) MarshalText() ([]byte, error) { return []byte(mask), nil }

// Format covers every fmt verb (%x, %d, …), not only %s and %v.
func (Secret) Format(f fmt.State, _ rune) { _, _ = f.Write([]byte(mask)) }

// Wipe overwrites a byte slice holding key material. Best effort: Go may have
// copied the bytes elsewhere, but this shortens their lifetime.
func Wipe(b []byte) {
	for i := range b {
		b[i] = 0
	}
}
