package config

import (
	"fmt"
	"strings"
	"testing"
)

func env(m map[string]string) func(string) string { return func(k string) string { return m[k] } }

func base() map[string]string {
	return map[string]string{
		"MONEY_DATABASE_URL":        "postgres://money@db/money?sslmode=verify-full",
		"MONEY_TLS_CERT_FILE":       "server.pem",
		"MONEY_TLS_KEY_FILE":        "server-key.pem",
		"MONEY_TLS_CLIENT_CA_FILE":  "ca.pem",
		"MONEY_TLS_ALLOWED_CLIENTS": "spiffe://sagolik/web, spiffe://sagolik/worker",
		"MONEY_LOCAL_KEYRING_FILE":  "keyring.json",
		"MONEY_ASSERTION_JWKS_FILE": "jwks.json",
	}
}

func TestValidConfigs(t *testing.T) {
	c, err := Load(env(base()))
	if err != nil {
		t.Fatal(err)
	}
	if len(c.AllowedClients) != 2 || c.Env != "local" || c.KeyProvider != "local" {
		t.Fatalf("unexpected %+v", c)
	}
	m := base()
	m["MONEY_ENV"], m["MONEY_KEY_PROVIDER"], m["MONEY_KMS_KEY_ID"] = "production", "awskms", "alias/sagolik-money"
	if _, err := Load(env(m)); err != nil {
		t.Fatalf("production with KMS should load: %v", err)
	}
	m = base()
	m["MONEY_ENV"], m["MONEY_KEY_PROVIDER"], m["MONEY_AZURE_KEY_ID"] = "production", "azurekv", "https://kv-money.vault.azure.net/keys/money-kek"
	m["MONEY_DATABASE_AUTH"], m["AZURE_CLIENT_ID"] = "entra", "00000000-0000-0000-0000-000000000001"
	m["MONEY_DATABASE_URL"] = "postgres://id-money@pg-money.postgres.database.azure.com:5432/money?sslmode=verify-full"
	c, err = Load(env(m))
	if err != nil {
		t.Fatalf("production on Azure (Key Vault, Entra sign-in) should load: %v", err)
	}
	if c.DatabaseAuth != "entra" || c.AzureClientID == "" {
		t.Fatalf("unexpected %+v", c)
	}
}

func TestUnsafeConfigsAreRefused(t *testing.T) {
	cases := map[string]func(m map[string]string){
		"no database":             func(m map[string]string) { delete(m, "MONEY_DATABASE_URL") },
		"plaintext outside local": func(m map[string]string) { m["MONEY_ENV"], m["MONEY_INSECURE_PLAINTEXT"] = "staging", "true" },
		"db without verify-full": func(m map[string]string) {
			m["MONEY_ENV"], m["MONEY_DATABASE_URL"] = "staging", "postgres://db/money?sslmode=require"
		},
		"missing client CA":        func(m map[string]string) { delete(m, "MONEY_TLS_CLIENT_CA_FILE") },
		"no allowed clients":       func(m map[string]string) { m["MONEY_TLS_ALLOWED_CLIENTS"] = " , " },
		"local keys in production": func(m map[string]string) { m["MONEY_ENV"] = "production" },
		"kms without key":          func(m map[string]string) { m["MONEY_KEY_PROVIDER"] = "awskms" },
		"key vault without key":    func(m map[string]string) { m["MONEY_KEY_PROVIDER"] = "azurekv" },
		"key vault key elsewhere": func(m map[string]string) {
			m["MONEY_KEY_PROVIDER"], m["MONEY_AZURE_KEY_ID"] = "azurekv", "https://evil.example/keys/money-kek"
		},
		"entra with a password": func(m map[string]string) {
			m["MONEY_DATABASE_AUTH"], m["MONEY_DATABASE_URL"] = "entra", "postgres://money:secret@db/money?sslmode=verify-full"
		},
		"unknown database auth":    func(m map[string]string) { m["MONEY_DATABASE_AUTH"] = "token" },
		"unknown provider":         func(m map[string]string) { m["MONEY_KEY_PROVIDER"] = "vault" },
		"no jwks":                  func(m map[string]string) { delete(m, "MONEY_ASSERTION_JWKS_FILE") },
		"cooling-off zero":         func(m map[string]string) { m["MONEY_COOLING_OFF_HOURS"] = "0" },
		"cooling-off not a number": func(m map[string]string) { m["MONEY_COOLING_OFF_HOURS"] = "1d" },
		"unknown env":              func(m map[string]string) { m["MONEY_ENV"] = "prod" },
	}
	for name, mutate := range cases {
		m := base()
		mutate(m)
		if _, err := Load(env(m)); err == nil {
			t.Errorf("%s: expected refusal", name)
		}
	}
	m := base()
	m["MONEY_ENV"], m["MONEY_ALLOW_LOCAL_KEYS_IN_PRODUCTION"] = "production", "true"
	if _, err := Load(env(m)); err != nil {
		t.Fatalf("explicit acknowledgement should allow local keys: %v", err)
	}
}

func TestDatabaseURLNeverPrinted(t *testing.T) {
	m := base()
	m["MONEY_DATABASE_URL"] = "postgres://money:hunter2@db/money?sslmode=verify-full"
	c, _ := Load(env(m))
	if s := strings.Join([]string{c.DatabaseURL.String()}, ""); strings.Contains(s, "hunter2") {
		t.Fatal("database url leaked")
	}
}

func plaidOn(m map[string]string) map[string]string {
	m["MONEY_PLAID_ENV"], m["MONEY_PLAID_CLIENT_ID"], m["MONEY_PLAID_SECRET_FILE"] = "sandbox", "client", "/run/secrets/plaid"
	m["MONEY_PLAID_REDIRECT_URI"] = "https://close.sagolik.com/api/v1/bank-connections/callback"
	return m
}

func TestPlaidConfig(t *testing.T) {
	c, err := Load(env(base()))
	if err != nil || c.PlaidEnv != "off" {
		t.Fatalf("plaid should default to off: %v %q", err, c.PlaidEnv)
	}
	if _, err := Load(env(plaidOn(base()))); err != nil {
		t.Fatalf("sandbox plaid should load: %v", err)
	}
	cases := map[string]func(m map[string]string){
		"unknown env": func(m map[string]string) { m["MONEY_PLAID_ENV"] = "development" },
		"sandbox in production": func(m map[string]string) {
			m["MONEY_ENV"], m["MONEY_KEY_PROVIDER"], m["MONEY_KMS_KEY_ID"] = "production", "awskms", "k"
		},
		"no client id": func(m map[string]string) { delete(m, "MONEY_PLAID_CLIENT_ID") },
		"no secret":    func(m map[string]string) { delete(m, "MONEY_PLAID_SECRET_FILE") },
		"two secrets":  func(m map[string]string) { m["MONEY_PLAID_SECRET"] = "s" },
		"no redirect":  func(m map[string]string) { delete(m, "MONEY_PLAID_REDIRECT_URI") },
		"http redirect": func(m map[string]string) {
			m["MONEY_ENV"], m["MONEY_PLAID_REDIRECT_URI"] = "staging", "http://close.example/cb"
		},
		"webhook without listener": func(m map[string]string) { m["MONEY_PLAID_WEBHOOK_URL"] = "https://hooks.example/webhooks/plaid" },
		"unknown optional product": func(m map[string]string) { m["MONEY_PLAID_OPTIONAL_PRODUCTS"] = "transactions,transfer" },
	}
	for name, mutate := range cases {
		m := plaidOn(base())
		mutate(m)
		if _, err := Load(env(m)); err == nil {
			t.Errorf("%s: expected refusal", name)
		}
	}
	m := plaidOn(base())
	m["MONEY_PLAID_OPTIONAL_PRODUCTS"] = " transactions , liabilities "
	if c, err := Load(env(m)); err != nil || strings.Join(c.PlaidOptionalProducts, ",") != "transactions,liabilities" {
		t.Fatalf("optional products: %v %v", err, c.PlaidOptionalProducts)
	}
	m = plaidOn(base())
	delete(m, "MONEY_PLAID_SECRET_FILE")
	m["MONEY_PLAID_SECRET"] = "very-secret-value"
	c, err = Load(env(m))
	if err != nil {
		t.Fatal(err)
	}
	if strings.Contains(fmt.Sprintf("%v %+v", c, c), "very-secret-value") {
		t.Fatal("plaid secret printed")
	}
}
