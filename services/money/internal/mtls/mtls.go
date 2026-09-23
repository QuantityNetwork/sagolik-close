// Package mtls configures mutual TLS for the internal API: TLS 1.3 only, a
// client certificate signed by our internal CA is required, and the client's
// identity (a URI SAN such as spiffe://sagolik/web) must be on the allow list.
package mtls

import (
	"crypto/tls"
	"crypto/x509"
	"errors"
	"fmt"
	"os"
	"slices"
)

// ServerConfig builds the TLS configuration for the money service listener.
func ServerConfig(certFile, keyFile, clientCAFile string, allowedClients []string) (*tls.Config, error) {
	if len(allowedClients) == 0 {
		return nil, errors.New("mtls: at least one allowed client identity is required")
	}
	cert, err := tls.LoadX509KeyPair(certFile, keyFile)
	if err != nil {
		return nil, fmt.Errorf("mtls: server certificate: %w", err)
	}
	caPEM, err := os.ReadFile(clientCAFile) // #nosec G304 -- path comes from trusted configuration
	if err != nil {
		return nil, fmt.Errorf("mtls: client CA: %w", err)
	}
	pool := x509.NewCertPool()
	if !pool.AppendCertsFromPEM(caPEM) {
		return nil, errors.New("mtls: client CA file has no certificates")
	}
	return NewServerConfig(cert, pool, allowedClients), nil
}

// NewServerConfig is ServerConfig for already-loaded material.
func NewServerConfig(cert tls.Certificate, clientCAs *x509.CertPool, allowedClients []string) *tls.Config {
	allowed := slices.Clone(allowedClients)
	return &tls.Config{
		MinVersion:   tls.VersionTLS13,
		Certificates: []tls.Certificate{cert},
		ClientAuth:   tls.RequireAndVerifyClientCert,
		ClientCAs:    clientCAs,
		// Runs after chain verification: pin the workload identity.
		VerifyConnection: func(cs tls.ConnectionState) error {
			if len(cs.PeerCertificates) == 0 {
				return errors.New("mtls: no client certificate")
			}
			id, err := Identity(cs.PeerCertificates[0])
			if err != nil {
				return err
			}
			if !slices.Contains(allowed, id) {
				return fmt.Errorf("mtls: client identity %q is not allowed", id)
			}
			return nil
		},
	}
}

// Identity returns the single URI SAN of a workload certificate.
func Identity(cert *x509.Certificate) (string, error) {
	if len(cert.URIs) != 1 {
		return "", fmt.Errorf("mtls: client certificate must carry exactly one URI identity, has %d", len(cert.URIs))
	}
	return cert.URIs[0].String(), nil
}
