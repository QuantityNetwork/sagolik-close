package mtls

import (
	"crypto/tls"
	"crypto/x509"
	"io"
	"net/http"
	"net/http/httptest"
	"testing"
	"time"
)

func TestMutualTLS(t *testing.T) {
	ca, err := NewCA("test-ca", time.Hour)
	if err != nil {
		t.Fatal(err)
	}
	server, _ := NewServerCert(ca, []string{"127.0.0.1", "localhost"}, time.Hour)
	web, _ := NewClientCert(ca, "spiffe://sagolik/web", time.Hour)
	worker, _ := NewClientCert(ca, "spiffe://sagolik/worker", time.Hour)
	otherCA, _ := NewCA("other-ca", time.Hour)
	impostor, _ := NewClientCert(otherCA, "spiffe://sagolik/web", time.Hour)

	pool := x509.NewCertPool()
	pool.AddCert(ca.Cert)
	serverTLS, _ := server.TLS()

	srv := httptest.NewUnstartedServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		id, _ := Identity(r.TLS.PeerCertificates[0])
		_, _ = io.WriteString(w, id)
	}))
	srv.TLS = NewServerConfig(serverTLS, pool, []string{"spiffe://sagolik/web"})
	srv.StartTLS()
	defer srv.Close()

	call := func(client *Issued, maxVersion uint16) (string, error) {
		cfg := &tls.Config{RootCAs: pool, MinVersion: tls.VersionTLS12, MaxVersion: maxVersion}
		if client != nil {
			c, _ := client.TLS()
			cfg.Certificates = []tls.Certificate{c}
		}
		hc := &http.Client{Transport: &http.Transport{TLSClientConfig: cfg}, Timeout: 5 * time.Second}
		res, err := hc.Get(srv.URL)
		if err != nil {
			return "", err
		}
		defer res.Body.Close()
		b, _ := io.ReadAll(res.Body)
		return string(b), nil
	}

	if id, err := call(&web, 0); err != nil || id != "spiffe://sagolik/web" {
		t.Fatalf("allowed client rejected: %v %q", err, id)
	}
	for name, c := range map[string]*Issued{"no certificate": nil, "identity not allowed": &worker, "foreign CA": &impostor} {
		if _, err := call(c, 0); err == nil {
			t.Errorf("%s: connection should fail", name)
		}
	}
	if _, err := call(&web, tls.VersionTLS12); err == nil {
		t.Error("TLS 1.2 must be refused")
	}
}
