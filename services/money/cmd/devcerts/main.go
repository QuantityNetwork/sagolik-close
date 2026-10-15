// Command devcerts creates the mutual-TLS and assertion material for the
// money service: an internal CA, a server certificate, client certificates for
// the web app and worker, the web app's Ed25519 assertion signing key (private
// JWK) with its public JWKS, and optionally a local keyring.
//
// Local development:
//
//	go run ./cmd/devcerts -out .dev
//
// An Azure environment (once per environment, on an operator's machine; see
// docs/azure/runbook.md). Keep the CA key offline afterwards; the keyring isn't
// needed because Key Vault holds the key-encryption key:
//
//	go run ./cmd/devcerts -out <dir> -hosts money.<environment domain> -days 397 -keyring=false
package main

import (
	"crypto/ed25519"
	"crypto/rand"
	"encoding/base64"
	"encoding/json"
	"errors"
	"flag"
	"fmt"
	"os"
	"path/filepath"
	"strings"
	"time"

	"github.com/quantitynetwork/sagolik-close/services/money/internal/keys"
	"github.com/quantitynetwork/sagolik-close/services/money/internal/mtls"
)

func main() {
	out := flag.String("out", ".dev", "output directory")
	hosts := flag.String("hosts", "localhost,127.0.0.1", "comma-separated names and addresses for the server certificate")
	days := flag.Int("days", 90, "certificate validity in days (at most 397)")
	kid := flag.String("kid", "web-1", "key id of the assertion signing key (MONEY_ASSERTION_KID)")
	keyring := flag.Bool("keyring", true, "also write a local keyring (not needed with Key Vault or KMS)")
	flag.Parse()
	if err := run(*out, splitList(*hosts), *days, *kid, *keyring); err != nil {
		fmt.Fprintln(os.Stderr, "devcerts:", err)
		os.Exit(1)
	}
}

func splitList(s string) []string {
	var out []string
	for _, v := range strings.Split(s, ",") {
		if v = strings.TrimSpace(v); v != "" {
			out = append(out, v)
		}
	}
	return out
}

func run(out string, hosts []string, days int, kid string, withKeyring bool) error {
	if len(hosts) == 0 {
		return errors.New("at least one server host is required")
	}
	if days < 1 || days > 397 {
		return errors.New("-days must be between 1 and 397")
	}
	if err := os.MkdirAll(out, 0o700); err != nil {
		return err
	}
	validity := time.Duration(days) * 24 * time.Hour
	ca, err := mtls.NewCA("Sagolik Close internal CA", validity)
	if err != nil {
		return err
	}
	server, err := mtls.NewServerCert(ca, hosts, validity)
	if err != nil {
		return err
	}
	files := map[string][]byte{"ca.pem": ca.CertPEM, "ca-key.pem": ca.KeyPEM, "server.pem": server.CertPEM, "server-key.pem": server.KeyPEM}
	for _, id := range []string{"web", "worker"} {
		c, err := mtls.NewClientCert(ca, "spiffe://sagolik/"+id, validity)
		if err != nil {
			return err
		}
		files[id+".pem"], files[id+"-key.pem"] = c.CertPEM, c.KeyPEM
	}
	signing, jwks, err := assertionKeys(kid)
	if err != nil {
		return err
	}
	files["signing.jwk"], files["jwks.json"] = signing, jwks
	if withKeyring {
		keyring, err := keys.NewKeyringDocument("v1")
		if err != nil {
			return err
		}
		files["keyring.json"] = keyring
	}
	for name, data := range files {
		if err := os.WriteFile(filepath.Join(out, name), data, 0o600); err != nil {
			return err
		}
	}
	fmt.Printf("wrote the CA, server (%s), web and worker certificates and the assertion keys to %s\n", strings.Join(hosts, ", "), out)
	return nil
}

// assertionKeys returns the web app's Ed25519 signing key as a private JWK and
// its public half as the JWKS the money service trusts.
func assertionKeys(kid string) (private, jwks []byte, err error) {
	pub, priv, err := ed25519.GenerateKey(rand.Reader)
	if err != nil {
		return nil, nil, err
	}
	b64 := base64.RawURLEncoding.EncodeToString
	private, err = json.Marshal(map[string]string{"kty": "OKP", "crv": "Ed25519", "x": b64(pub), "d": b64(priv.Seed())})
	if err != nil {
		return nil, nil, err
	}
	jwks, err = json.Marshal(map[string]any{"keys": []map[string]string{{"kty": "OKP", "crv": "Ed25519", "kid": kid, "x": b64(pub), "use": "sig", "alg": "EdDSA"}}})
	return private, jwks, err
}
