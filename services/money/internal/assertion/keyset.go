package assertion

import (
	"bytes"
	"crypto/ed25519"
	"encoding/base64"
	"encoding/json"
	"errors"
	"fmt"
	"os"
)

// KeySet holds the web app's public verification keys (a JWKS of Ed25519 keys).
// Rotation: publish the new key alongside the old, switch signing, then drop the old.
type KeySet struct{ keys map[string]ed25519.PublicKey }

type jwks struct {
	Keys []struct {
		Kty string `json:"kty"`
		Crv string `json:"crv"`
		Kid string `json:"kid"`
		X   string `json:"x"`
		Use string `json:"use,omitempty"`
		Alg string `json:"alg,omitempty"`
	} `json:"keys"`
}

// ParseJWKS accepts only OKP/Ed25519 public keys (never private material).
func ParseJWKS(data []byte) (*KeySet, error) {
	var doc jwks
	dec := json.NewDecoder(bytes.NewReader(data))
	dec.DisallowUnknownFields()
	if err := dec.Decode(&doc); err != nil {
		return nil, fmt.Errorf("assertion: jwks: %w", err)
	}
	ks := &KeySet{keys: map[string]ed25519.PublicKey{}}
	for _, k := range doc.Keys {
		if k.Kty != "OKP" || k.Crv != "Ed25519" {
			return nil, fmt.Errorf("assertion: jwks key %q is not Ed25519", k.Kid)
		}
		if k.Alg != "" && k.Alg != "EdDSA" {
			return nil, fmt.Errorf("assertion: jwks key %q has alg %q", k.Kid, k.Alg)
		}
		if k.Use != "" && k.Use != "sig" {
			return nil, fmt.Errorf("assertion: jwks key %q is not a signing key", k.Kid)
		}
		if k.Kid == "" || len(k.Kid) > 64 {
			return nil, errors.New("assertion: jwks key without a valid kid")
		}
		x, err := base64.RawURLEncoding.Strict().DecodeString(k.X)
		if err != nil || len(x) != ed25519.PublicKeySize {
			return nil, fmt.Errorf("assertion: jwks key %q: bad x", k.Kid)
		}
		if _, dup := ks.keys[k.Kid]; dup {
			return nil, fmt.Errorf("assertion: duplicate kid %q", k.Kid)
		}
		ks.keys[k.Kid] = ed25519.PublicKey(x)
	}
	if len(ks.keys) == 0 {
		return nil, errors.New("assertion: jwks has no keys")
	}
	return ks, nil
}

func LoadJWKSFile(path string) (*KeySet, error) {
	data, err := os.ReadFile(path) // #nosec G304 -- path comes from trusted configuration
	if err != nil {
		return nil, fmt.Errorf("assertion: jwks: %w", err)
	}
	return ParseJWKS(data)
}

func (k *KeySet) Get(kid string) (ed25519.PublicKey, bool) {
	pub, ok := k.keys[kid]
	return pub, ok
}
