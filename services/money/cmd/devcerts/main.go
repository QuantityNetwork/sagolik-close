// Command devcerts creates everything needed to run the money service locally:
// an internal CA, a server certificate, client certificates for the web app and
// worker, and a local keyring. Development only — production uses a managed
// private CA (or service mesh) and AWS KMS.
//
//	go run ./cmd/devcerts -out .dev
package main

import (
	"flag"
	"fmt"
	"os"
	"path/filepath"
	"time"

	"github.com/quantitynetwork/sagolik-close/services/money/internal/keys"
	"github.com/quantitynetwork/sagolik-close/services/money/internal/mtls"
)

func main() {
	out := flag.String("out", ".dev", "output directory")
	flag.Parse()
	if err := run(*out); err != nil {
		fmt.Fprintln(os.Stderr, "devcerts:", err)
		os.Exit(1)
	}
}

func run(out string) error {
	if err := os.MkdirAll(out, 0o700); err != nil {
		return err
	}
	const validity = 90 * 24 * time.Hour
	ca, err := mtls.NewCA("Sagolik Close local CA", validity)
	if err != nil {
		return err
	}
	server, err := mtls.NewServerCert(ca, []string{"localhost", "127.0.0.1"}, validity)
	if err != nil {
		return err
	}
	files := map[string][]byte{"ca.pem": ca.CertPEM, "server.pem": server.CertPEM, "server-key.pem": server.KeyPEM}
	for _, id := range []string{"web", "worker"} {
		c, err := mtls.NewClientCert(ca, "spiffe://sagolik/"+id, validity)
		if err != nil {
			return err
		}
		files[id+".pem"], files[id+"-key.pem"] = c.CertPEM, c.KeyPEM
	}
	keyring, err := keys.NewKeyringDocument("v1")
	if err != nil {
		return err
	}
	files["keyring.json"] = keyring
	for name, data := range files {
		if err := os.WriteFile(filepath.Join(out, name), data, 0o600); err != nil {
			return err
		}
	}
	fmt.Printf("wrote CA, server, web and worker certificates and a local keyring to %s\n", out)
	return nil
}
