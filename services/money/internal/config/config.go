// Package config reads the money service configuration from the environment
// and refuses unsafe combinations instead of falling back to defaults.
package config

import (
	"errors"
	"fmt"
	"net/url"
	"strconv"
	"strings"
	"time"

	"github.com/quantitynetwork/sagolik-close/services/money/internal/redact"
)

type Config struct {
	Env        string // local | staging | production
	ListenAddr string // internal API (mTLS)
	HealthAddr string // plaintext liveness/readiness, bind to a private interface

	DatabaseURL    redact.Secret
	MigrateOnStart bool

	TLSCertFile     string
	TLSKeyFile      string
	TLSClientCAFile string
	AllowedClients  []string
	Plaintext       bool // local development only

	KeyProvider                string // local | awskms
	KeyringFile                string
	KMSKeyID                   string
	AllowLocalKeysInProduction bool

	AssertionJWKSFile string
	AssertionIssuer   string
	AssertionAudience string

	// CoolingOff is the waiting period before changed payment instructions can be used.
	CoolingOff time.Duration

	// Plaid (bank connections). PlaidEnv "off" disables the bank endpoints.
	PlaidEnv         string // off | sandbox | production
	PlaidClientID    string
	PlaidSecret      redact.Secret
	PlaidSecretFile  string
	PlaidRedirectURI string // the web app's callback for Hosted Link
	PlaidWebhookURL  string // public URL that reaches WebhookAddr (optional)
	// PlaidOptionalProducts: opt-in "transactions" and/or "liabilities" for Property Autopilot.
	PlaidOptionalProducts []string
	WebhookAddr           string // listener for provider webhooks (no mTLS; signature-checked)
}

// Load parses configuration using getenv (os.Getenv in production).
func Load(getenv func(string) string) (Config, error) {
	get := func(k, def string) string {
		if v := strings.TrimSpace(getenv(k)); v != "" {
			return v
		}
		return def
	}
	c := Config{
		Env:                        get("MONEY_ENV", "local"),
		ListenAddr:                 get("MONEY_LISTEN_ADDR", ":8443"),
		HealthAddr:                 get("MONEY_HEALTH_ADDR", "127.0.0.1:8081"),
		DatabaseURL:                redact.NewSecret(get("MONEY_DATABASE_URL", "")),
		MigrateOnStart:             get("MONEY_MIGRATE_ON_START", "false") == "true",
		TLSCertFile:                get("MONEY_TLS_CERT_FILE", ""),
		TLSKeyFile:                 get("MONEY_TLS_KEY_FILE", ""),
		TLSClientCAFile:            get("MONEY_TLS_CLIENT_CA_FILE", ""),
		Plaintext:                  get("MONEY_INSECURE_PLAINTEXT", "false") == "true",
		KeyProvider:                get("MONEY_KEY_PROVIDER", "local"),
		KeyringFile:                get("MONEY_LOCAL_KEYRING_FILE", ""),
		KMSKeyID:                   get("MONEY_KMS_KEY_ID", ""),
		AllowLocalKeysInProduction: get("MONEY_ALLOW_LOCAL_KEYS_IN_PRODUCTION", "false") == "true",
		AssertionJWKSFile:          get("MONEY_ASSERTION_JWKS_FILE", ""),
		AssertionIssuer:            get("MONEY_ASSERTION_ISSUER", "sagolik-web"),
		AssertionAudience:          get("MONEY_ASSERTION_AUDIENCE", "sagolik-money"),
		PlaidEnv:                   get("MONEY_PLAID_ENV", "off"),
		PlaidClientID:              get("MONEY_PLAID_CLIENT_ID", ""),
		PlaidSecret:                redact.NewSecret(get("MONEY_PLAID_SECRET", "")),
		PlaidSecretFile:            get("MONEY_PLAID_SECRET_FILE", ""),
		PlaidRedirectURI:           get("MONEY_PLAID_REDIRECT_URI", ""),
		PlaidWebhookURL:            get("MONEY_PLAID_WEBHOOK_URL", ""),
		WebhookAddr:                get("MONEY_WEBHOOK_ADDR", ""),
	}
	for _, p := range strings.Split(get("MONEY_PLAID_OPTIONAL_PRODUCTS", ""), ",") {
		if p = strings.TrimSpace(p); p != "" {
			c.PlaidOptionalProducts = append(c.PlaidOptionalProducts, p)
		}
	}
	hours, err := strconv.Atoi(get("MONEY_COOLING_OFF_HOURS", "24"))
	if err != nil || hours < 1 || hours > 168 {
		return c, errors.New("MONEY_COOLING_OFF_HOURS must be a whole number of hours between 1 and 168")
	}
	c.CoolingOff = time.Duration(hours) * time.Hour
	for _, id := range strings.Split(get("MONEY_TLS_ALLOWED_CLIENTS", ""), ",") {
		if id = strings.TrimSpace(id); id != "" {
			c.AllowedClients = append(c.AllowedClients, id)
		}
	}
	return c, c.validate()
}

func (c Config) validate() error {
	var errs []error
	bad := func(format string, a ...any) { errs = append(errs, fmt.Errorf(format, a...)) }

	if c.Env != "local" && c.Env != "staging" && c.Env != "production" {
		bad("MONEY_ENV must be local, staging or production")
	}
	if c.DatabaseURL.IsZero() {
		bad("MONEY_DATABASE_URL is required")
	} else if c.Env != "local" {
		u, err := url.Parse(c.DatabaseURL.Reveal())
		if err != nil || u.Query().Get("sslmode") != "verify-full" {
			bad("MONEY_DATABASE_URL must use sslmode=verify-full outside local development")
		}
	}
	if c.Plaintext {
		if c.Env != "local" {
			bad("MONEY_INSECURE_PLAINTEXT is only allowed when MONEY_ENV=local")
		}
	} else {
		if c.TLSCertFile == "" || c.TLSKeyFile == "" || c.TLSClientCAFile == "" {
			bad("MONEY_TLS_CERT_FILE, MONEY_TLS_KEY_FILE and MONEY_TLS_CLIENT_CA_FILE are required (mutual TLS)")
		}
		if len(c.AllowedClients) == 0 {
			bad("MONEY_TLS_ALLOWED_CLIENTS must list the client identities (e.g. spiffe://sagolik/web)")
		}
	}
	switch c.KeyProvider {
	case "local":
		if c.KeyringFile == "" {
			bad("MONEY_LOCAL_KEYRING_FILE is required with MONEY_KEY_PROVIDER=local")
		}
		if c.Env == "production" && !c.AllowLocalKeysInProduction {
			bad("production uses AWS KMS; set MONEY_ALLOW_LOCAL_KEYS_IN_PRODUCTION=true to accept file-based keys deliberately")
		}
	case "awskms":
		if c.KMSKeyID == "" {
			bad("MONEY_KMS_KEY_ID is required with MONEY_KEY_PROVIDER=awskms")
		}
	default:
		bad("MONEY_KEY_PROVIDER must be local or awskms")
	}
	if c.AssertionJWKSFile == "" {
		bad("MONEY_ASSERTION_JWKS_FILE is required (the web app's public keys)")
	}
	c.validatePlaid(bad)
	return errors.Join(errs...)
}

func (c Config) validatePlaid(bad func(string, ...any)) {
	switch c.PlaidEnv {
	case "off":
		return
	case "sandbox":
		if c.Env == "production" {
			bad("MONEY_PLAID_ENV=sandbox is not allowed when MONEY_ENV=production")
		}
	case "production":
	default:
		bad("MONEY_PLAID_ENV must be off, sandbox or production")
		return
	}
	if c.PlaidClientID == "" {
		bad("MONEY_PLAID_CLIENT_ID is required when Plaid is on")
	}
	if c.PlaidSecret.IsZero() == (c.PlaidSecretFile == "") {
		bad("set exactly one of MONEY_PLAID_SECRET_FILE or MONEY_PLAID_SECRET (e.g. injected from AWS Secrets Manager)")
	}
	checkURL := func(name, v string, required bool) {
		if v == "" {
			if required {
				bad("%s is required when Plaid is on", name)
			}
			return
		}
		u, err := url.Parse(v)
		if err != nil || u.Host == "" || (u.Scheme != "https" && !(c.Env == "local" && u.Scheme == "http")) {
			bad("%s must be an https URL", name)
		}
	}
	for _, p := range c.PlaidOptionalProducts {
		if p != "transactions" && p != "liabilities" {
			bad("MONEY_PLAID_OPTIONAL_PRODUCTS may only list transactions and liabilities")
		}
	}
	checkURL("MONEY_PLAID_REDIRECT_URI", c.PlaidRedirectURI, true)
	checkURL("MONEY_PLAID_WEBHOOK_URL", c.PlaidWebhookURL, false)
	if c.PlaidWebhookURL != "" && c.WebhookAddr == "" {
		bad("MONEY_WEBHOOK_ADDR is required when MONEY_PLAID_WEBHOOK_URL is set")
	}
}
