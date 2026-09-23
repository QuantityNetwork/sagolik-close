package keys

import (
	"context"
	"crypto/rand"
	"encoding/base64"
	"encoding/json"
	"errors"
	"fmt"
	"os"
	"regexp"
	"strings"

	"github.com/quantitynetwork/sagolik-close/services/money/internal/redact"
)

// LocalProvider keeps versioned KEKs in a keyring file. It costs nothing and
// needs no cloud account; the trade-off is that KEKs live in process memory
// and on disk (protect the file: 0600, secret store, never in the image).
//
// Keyring file format:
//
//	{"active": "v2", "keys": {"v1": "<base64 32 bytes>", "v2": "<base64 32 bytes>"}}
//
// New values are wrapped with the active KEK; older versions still unwrap.
type LocalProvider struct {
	active string
	keks   map[string][]byte
}

var versionRe = regexp.MustCompile(`^[a-z0-9][a-z0-9_-]{0,31}$`)

type keyringFile struct {
	Active string            `json:"active"`
	Keys   map[string]string `json:"keys"`
}

// ParseKeyring validates a keyring document.
func ParseKeyring(data []byte) (*LocalProvider, error) {
	var f keyringFile
	dec := json.NewDecoder(strings.NewReader(string(data)))
	dec.DisallowUnknownFields()
	if err := dec.Decode(&f); err != nil {
		return nil, fmt.Errorf("keys: keyring: %w", err)
	}
	if len(f.Keys) == 0 {
		return nil, errors.New("keys: keyring has no keys")
	}
	p := &LocalProvider{active: f.Active, keks: map[string][]byte{}}
	for v, b64 := range f.Keys {
		if !versionRe.MatchString(v) {
			return nil, fmt.Errorf("keys: keyring version %q is not a valid name", v)
		}
		k, err := base64.StdEncoding.DecodeString(b64)
		if err != nil || len(k) != 32 {
			return nil, fmt.Errorf("keys: keyring key %q must be 32 bytes, base64", v)
		}
		p.keks[v] = k
	}
	if _, ok := p.keks[f.Active]; !ok {
		return nil, fmt.Errorf("keys: active key %q is not in the keyring", f.Active)
	}
	return p, nil
}

// LoadKeyringFile reads a keyring and refuses files readable by group/others.
func LoadKeyringFile(path string) (*LocalProvider, error) {
	st, err := os.Stat(path)
	if err != nil {
		return nil, fmt.Errorf("keys: keyring: %w", err)
	}
	if st.Mode().Perm()&0o077 != 0 {
		return nil, fmt.Errorf("keys: keyring %s must not be readable by group or others (chmod 600)", path)
	}
	data, err := os.ReadFile(path) // #nosec G304 -- path comes from trusted configuration
	if err != nil {
		return nil, fmt.Errorf("keys: keyring: %w", err)
	}
	defer redact.Wipe(data)
	return ParseKeyring(data)
}

// NewKeyringDocument creates a keyring with one fresh key (for setup tooling and tests).
func NewKeyringDocument(version string) ([]byte, error) {
	k := make([]byte, 32)
	if _, err := rand.Read(k); err != nil {
		return nil, err
	}
	defer redact.Wipe(k)
	return json.MarshalIndent(keyringFile{Active: version, Keys: map[string]string{version: base64.StdEncoding.EncodeToString(k)}}, "", "  ")
}

func (p *LocalProvider) Name() string { return "local" }

// ActiveVersion is the KEK version used for new values.
func (p *LocalProvider) ActiveVersion() string { return p.active }

func (p *LocalProvider) GenerateDataKey(_ context.Context, ec Context) ([]byte, []byte, string, error) {
	dek := make([]byte, 32)
	if _, err := rand.Read(dek); err != nil {
		return nil, nil, "", err
	}
	nonce, ct, err := gcmSeal(p.keks[p.active], dek, ec.aad())
	if err != nil {
		redact.Wipe(dek)
		return nil, nil, "", err
	}
	return dek, append(nonce, ct...), "local:" + p.active, nil
}

func (p *LocalProvider) DecryptDataKey(_ context.Context, wrapped []byte, keyRef string, ec Context) ([]byte, error) {
	version, ok := strings.CutPrefix(keyRef, "local:")
	if !ok {
		return nil, fmt.Errorf("keys: key reference %q is not a local key", keyRef)
	}
	kek, ok := p.keks[version]
	if !ok {
		return nil, fmt.Errorf("keys: key version %q is not in the keyring", version)
	}
	if len(wrapped) < 12+16 {
		return nil, errors.New("keys: wrapped key too short")
	}
	return gcmOpen(kek, wrapped[:12], wrapped[12:], ec.aad())
}
