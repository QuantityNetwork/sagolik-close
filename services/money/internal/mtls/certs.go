package mtls

import (
	"crypto/ecdsa"
	"crypto/elliptic"
	"crypto/rand"
	"crypto/tls"
	"crypto/x509"
	"crypto/x509/pkix"
	"encoding/pem"
	"math/big"
	"net"
	"net/url"
	"time"
)

// Issued is a generated certificate with its key, in PEM.
type Issued struct {
	Cert    *x509.Certificate
	CertPEM []byte
	KeyPEM  []byte
	key     *ecdsa.PrivateKey
}

// TLS returns the pair as a tls.Certificate.
func (i Issued) TLS() (tls.Certificate, error) { return tls.X509KeyPair(i.CertPEM, i.KeyPEM) }

// NewCA creates a self-signed P-256 CA (local development and tests; production
// uses a managed private CA or a service mesh).
func NewCA(name string, validity time.Duration) (Issued, error) {
	tmpl := &x509.Certificate{
		Subject:               pkix.Name{CommonName: name, Organization: []string{"Sagolik Close (internal)"}},
		IsCA:                  true,
		BasicConstraintsValid: true,
		MaxPathLenZero:        true,
		KeyUsage:              x509.KeyUsageCertSign | x509.KeyUsageCRLSign,
	}
	return issue(tmpl, nil, validity)
}

// NewServerCert issues a server certificate for the given DNS names / IPs.
func NewServerCert(ca Issued, hosts []string, validity time.Duration) (Issued, error) {
	tmpl := &x509.Certificate{
		Subject:     pkix.Name{CommonName: hosts[0]},
		KeyUsage:    x509.KeyUsageDigitalSignature,
		ExtKeyUsage: []x509.ExtKeyUsage{x509.ExtKeyUsageServerAuth},
	}
	for _, h := range hosts {
		if ip := net.ParseIP(h); ip != nil {
			tmpl.IPAddresses = append(tmpl.IPAddresses, ip)
		} else {
			tmpl.DNSNames = append(tmpl.DNSNames, h)
		}
	}
	return issue(tmpl, &ca, validity)
}

// NewClientCert issues a workload client certificate with a URI identity.
func NewClientCert(ca Issued, identity string, validity time.Duration) (Issued, error) {
	u, err := url.Parse(identity)
	if err != nil {
		return Issued{}, err
	}
	tmpl := &x509.Certificate{
		Subject:     pkix.Name{CommonName: identity},
		URIs:        []*url.URL{u},
		KeyUsage:    x509.KeyUsageDigitalSignature,
		ExtKeyUsage: []x509.ExtKeyUsage{x509.ExtKeyUsageClientAuth},
	}
	return issue(tmpl, &ca, validity)
}

func issue(tmpl *x509.Certificate, parent *Issued, validity time.Duration) (Issued, error) {
	key, err := ecdsa.GenerateKey(elliptic.P256(), rand.Reader)
	if err != nil {
		return Issued{}, err
	}
	serial, err := rand.Int(rand.Reader, new(big.Int).Lsh(big.NewInt(1), 127))
	if err != nil {
		return Issued{}, err
	}
	tmpl.SerialNumber = serial
	tmpl.NotBefore = time.Now().Add(-time.Minute)
	tmpl.NotAfter = time.Now().Add(validity)
	parentCert, signer := tmpl, key
	if parent != nil {
		parentCert, signer = parent.Cert, parent.key
	}
	der, err := x509.CreateCertificate(rand.Reader, tmpl, parentCert, &key.PublicKey, signer)
	if err != nil {
		return Issued{}, err
	}
	cert, err := x509.ParseCertificate(der)
	if err != nil {
		return Issued{}, err
	}
	keyDER, err := x509.MarshalECPrivateKey(key)
	if err != nil {
		return Issued{}, err
	}
	return Issued{
		Cert:    cert,
		CertPEM: pem.EncodeToMemory(&pem.Block{Type: "CERTIFICATE", Bytes: der}),
		KeyPEM:  pem.EncodeToMemory(&pem.Block{Type: "EC PRIVATE KEY", Bytes: keyDER}),
		key:     key,
	}, nil
}
