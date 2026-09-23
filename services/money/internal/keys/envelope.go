// Package keys implements envelope encryption for sensitive fields.
//
// Each sealed value gets its own random 256-bit data key (DEK). The value is
// encrypted with AES-256-GCM under the DEK; the DEK itself is wrapped by a
// key-encryption key (KEK) held by a Provider — a local keyring, or AWS KMS
// where the KEK never leaves the HSM. Both layers are bound to an encryption
// Context (purpose + record id), so a ciphertext copied onto another row, or
// used for another purpose, fails to decrypt.
package keys

import (
	"context"
	"crypto/aes"
	"crypto/cipher"
	"crypto/rand"
	"encoding/base64"
	"encoding/json"
	"errors"
	"fmt"
	"sort"
	"strings"

	"github.com/quantitynetwork/sagolik-close/services/money/internal/redact"
)

// Context binds a ciphertext to where it belongs. Purpose and RecordID are required.
type Context struct {
	Purpose  string // e.g. "bank_connection.access_token"
	RecordID string // primary key of the owning row
}

func (c Context) validate() error {
	if c.Purpose == "" || c.RecordID == "" {
		return errors.New("keys: encryption context needs purpose and record id")
	}
	return nil
}

// Map is the context in the form KMS encryption contexts use.
func (c Context) Map() map[string]string {
	return map[string]string{"purpose": c.Purpose, "record": c.RecordID}
}

// aad is a canonical, unambiguous encoding of the context for GCM.
func (c Context) aad() []byte {
	m := c.Map()
	ks := make([]string, 0, len(m))
	for k := range m {
		ks = append(ks, k)
	}
	sort.Strings(ks)
	var b strings.Builder
	for _, k := range ks {
		fmt.Fprintf(&b, "%d:%s=%d:%s;", len(k), k, len(m[k]), m[k])
	}
	return []byte(b.String())
}

// Provider wraps and unwraps data keys with a key-encryption key.
type Provider interface {
	// Name identifies the provider in sealed values ("local", "awskms").
	Name() string
	// GenerateDataKey returns a fresh 32-byte DEK, the DEK wrapped by the
	// provider's active KEK, and a reference to that KEK.
	GenerateDataKey(ctx context.Context, ec Context) (dek []byte, wrapped []byte, keyRef string, err error)
	// DecryptDataKey unwraps a DEK. It must fail if ec differs from sealing time.
	DecryptDataKey(ctx context.Context, wrapped []byte, keyRef string, ec Context) ([]byte, error)
}

// ErrDecrypt is returned for any failure to open a sealed value. It says
// nothing about why, so it can't be used as an oracle.
var ErrDecrypt = errors.New("keys: unable to decrypt value")

const prefix = "sce1."

type sealed struct {
	Provider string `json:"p"`
	KeyRef   string `json:"k"`
	Wrapped  []byte `json:"w"`
	Nonce    []byte `json:"n"`
	Cipher   []byte `json:"c"`
}

// Envelope seals and opens values with a Provider.
type Envelope struct{ p Provider }

func NewEnvelope(p Provider) *Envelope { return &Envelope{p: p} }

func (e *Envelope) ProviderName() string { return e.p.Name() }

// Seal encrypts plaintext for the given context. The result is a printable
// string ("sce1.…") safe to store in a text column.
func (e *Envelope) Seal(ctx context.Context, plaintext []byte, ec Context) (string, error) {
	if err := ec.validate(); err != nil {
		return "", err
	}
	dek, wrapped, keyRef, err := e.p.GenerateDataKey(ctx, ec)
	if err != nil {
		return "", fmt.Errorf("keys: generate data key: %w", err)
	}
	defer redact.Wipe(dek)
	nonce, ct, err := gcmSeal(dek, plaintext, ec.aad())
	if err != nil {
		return "", err
	}
	raw, err := json.Marshal(sealed{Provider: e.p.Name(), KeyRef: keyRef, Wrapped: wrapped, Nonce: nonce, Cipher: ct})
	if err != nil {
		return "", err
	}
	return prefix + base64.RawURLEncoding.EncodeToString(raw), nil
}

// Open decrypts a value produced by Seal with the same context.
func (e *Envelope) Open(ctx context.Context, value string, ec Context) ([]byte, error) {
	if err := ec.validate(); err != nil {
		return nil, err
	}
	s, err := parseSealed(value)
	if err != nil {
		return nil, ErrDecrypt
	}
	if s.Provider != e.p.Name() {
		return nil, fmt.Errorf("keys: value sealed by provider %q, configured provider is %q", s.Provider, e.p.Name())
	}
	dek, err := e.p.DecryptDataKey(ctx, s.Wrapped, s.KeyRef, ec)
	if err != nil {
		return nil, ErrDecrypt
	}
	defer redact.Wipe(dek)
	pt, err := gcmOpen(dek, s.Nonce, s.Cipher, ec.aad())
	if err != nil {
		return nil, ErrDecrypt
	}
	return pt, nil
}

// KeyRefOf reports which KEK sealed a value (for rotation reporting).
func KeyRefOf(value string) (string, error) {
	s, err := parseSealed(value)
	if err != nil {
		return "", err
	}
	return s.KeyRef, nil
}

func parseSealed(value string) (sealed, error) {
	var s sealed
	if !strings.HasPrefix(value, prefix) {
		return s, errors.New("keys: not a sealed value")
	}
	raw, err := base64.RawURLEncoding.DecodeString(strings.TrimPrefix(value, prefix))
	if err != nil {
		return s, err
	}
	dec := json.NewDecoder(strings.NewReader(string(raw)))
	dec.DisallowUnknownFields()
	if err := dec.Decode(&s); err != nil {
		return s, err
	}
	if s.Provider == "" || s.KeyRef == "" || len(s.Wrapped) == 0 || len(s.Nonce) != 12 || len(s.Cipher) < 16 {
		return s, errors.New("keys: malformed sealed value")
	}
	return s, nil
}

func gcmSeal(key, plaintext, aad []byte) (nonce, ct []byte, err error) {
	aead, err := newGCM(key)
	if err != nil {
		return nil, nil, err
	}
	nonce = make([]byte, aead.NonceSize())
	if _, err := rand.Read(nonce); err != nil {
		return nil, nil, err
	}
	return nonce, aead.Seal(nil, nonce, plaintext, aad), nil
}

func gcmOpen(key, nonce, ct, aad []byte) ([]byte, error) {
	aead, err := newGCM(key)
	if err != nil {
		return nil, err
	}
	return aead.Open(nil, nonce, ct, aad)
}

func newGCM(key []byte) (cipher.AEAD, error) {
	if len(key) != 32 {
		return nil, errors.New("keys: key must be 32 bytes")
	}
	block, err := aes.NewCipher(key)
	if err != nil {
		return nil, err
	}
	return cipher.NewGCM(block)
}
