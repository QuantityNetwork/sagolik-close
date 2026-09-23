package config

import (
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
		"unknown provider":         func(m map[string]string) { m["MONEY_KEY_PROVIDER"] = "vault" },
		"no jwks":                  func(m map[string]string) { delete(m, "MONEY_ASSERTION_JWKS_FILE") },
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
