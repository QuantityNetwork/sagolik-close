package keys

import (
	"context"
	"crypto/rand"
	"crypto/rsa"
	"crypto/sha256"
	"errors"
	"strings"
	"testing"

	"github.com/Azure/azure-sdk-for-go/sdk/security/keyvault/azkeys"
)

const testVault = "https://kv-money-test.vault.azure.net"

// fakeKeyVault does what Key Vault does with an RSA key: RSA-OAEP-256 wrap and
// unwrap, by key name and version, naming the version it used.
type fakeKeyVault struct {
	versions map[string]*rsa.PrivateKey
	latest   string
	unwraps  []string
}

func newFakeKeyVault(t *testing.T, versions ...string) *fakeKeyVault {
	t.Helper()
	f := &fakeKeyVault{versions: map[string]*rsa.PrivateKey{}}
	for _, v := range versions {
		k, err := rsa.GenerateKey(rand.Reader, 2048)
		if err != nil {
			t.Fatal(err)
		}
		f.versions[v], f.latest = k, v
	}
	return f
}

func (f *fakeKeyVault) key(name, version string) (*rsa.PrivateKey, string, error) {
	if version == "" {
		version = f.latest
	}
	k, ok := f.versions[version]
	if name != "money-kek" || !ok {
		return nil, "", errors.New("KeyNotFound")
	}
	return k, version, nil
}

func (f *fakeKeyVault) WrapKey(_ context.Context, name, version string, p azkeys.KeyOperationParameters, _ *azkeys.WrapKeyOptions) (azkeys.WrapKeyResponse, error) {
	k, version, err := f.key(name, version)
	if err != nil {
		return azkeys.WrapKeyResponse{}, err
	}
	if p.Algorithm == nil || *p.Algorithm != azkeys.EncryptionAlgorithmRSAOAEP256 {
		return azkeys.WrapKeyResponse{}, errors.New("unexpected algorithm")
	}
	ct, err := rsa.EncryptOAEP(sha256.New(), rand.Reader, &k.PublicKey, p.Value, nil)
	if err != nil {
		return azkeys.WrapKeyResponse{}, err
	}
	kid := azkeys.ID(testVault + "/keys/" + name + "/" + version)
	return azkeys.WrapKeyResponse{KeyOperationResult: azkeys.KeyOperationResult{KID: &kid, Result: ct}}, nil
}

func (f *fakeKeyVault) UnwrapKey(_ context.Context, name, version string, p azkeys.KeyOperationParameters, _ *azkeys.UnwrapKeyOptions) (azkeys.UnwrapKeyResponse, error) {
	f.unwraps = append(f.unwraps, version)
	k, version, err := f.key(name, version)
	if err != nil {
		return azkeys.UnwrapKeyResponse{}, err
	}
	pt, err := rsa.DecryptOAEP(sha256.New(), nil, k, p.Value, nil)
	if err != nil {
		return azkeys.UnwrapKeyResponse{}, err
	}
	kid := azkeys.ID(testVault + "/keys/" + name + "/" + version)
	return azkeys.UnwrapKeyResponse{KeyOperationResult: azkeys.KeyOperationResult{KID: &kid, Result: pt}}, nil
}

const (
	v1 = "0123456789abcdef0123456789abcdef"
	v2 = "fedcba9876543210fedcba9876543210"
)

func TestAzureKeyVaultRoundTripAndRotation(t *testing.T) {
	ctx := context.Background()
	kv := newFakeKeyVault(t, v1)
	p, err := NewAzureKeyVaultProvider(kv, testVault+"/keys/money-kek")
	if err != nil {
		t.Fatal(err)
	}
	env := NewEnvelope(p)
	old, err := env.Seal(ctx, []byte("access-sandbox-123"), ctxA)
	if err != nil {
		t.Fatal(err)
	}
	if ref, _ := KeyRefOf(old); ref != testVault+"/keys/money-kek/"+v1 {
		t.Fatalf("the key reference should pin the version used, got %q", ref)
	}

	// Rotation: a new key version in Key Vault. New values use it; old ones still open with theirs.
	kv.versions[v2], _ = rsa.GenerateKey(rand.Reader, 2048)
	kv.latest = v2
	fresh, err := env.Seal(ctx, []byte("access-sandbox-456"), ctxA)
	if err != nil {
		t.Fatal(err)
	}
	if ref, _ := KeyRefOf(fresh); !strings.HasSuffix(ref, "/"+v2) {
		t.Fatalf("new values should use the newest version, got %q", ref)
	}
	for value, want := range map[string]string{old: "access-sandbox-123", fresh: "access-sandbox-456"} {
		got, err := env.Open(ctx, value, ctxA)
		if err != nil || string(got) != want {
			t.Fatalf("open: %q, %v", got, err)
		}
	}
	if strings.Join(kv.unwraps, ",") != v1+","+v2 && strings.Join(kv.unwraps, ",") != v2+","+v1 {
		t.Fatalf("each value should unwrap with its own version, got %v", kv.unwraps)
	}

	// The context still binds: the same value can't be opened for another record.
	other := Context{Purpose: ctxA.Purpose, RecordID: "22222222-2222-4222-8222-222222222222"}
	if _, err := env.Open(ctx, old, other); !errors.Is(err, ErrDecrypt) {
		t.Fatalf("a value moved to another record must not open, got %v", err)
	}
}

func TestAzureKeyVaultOnlyUnwrapsItsOwnKey(t *testing.T) {
	ctx := context.Background()
	kv := newFakeKeyVault(t, v1)
	p, err := NewAzureKeyVaultProvider(kv, testVault+"/keys/money-kek")
	if err != nil {
		t.Fatal(err)
	}
	dek, wrapped, _, err := p.GenerateDataKey(ctx, ctxA)
	if err != nil || len(dek) != 32 {
		t.Fatalf("generate: %d bytes, %v", len(dek), err)
	}
	// A stored value naming another vault, another key, or no version is refused before any call.
	for _, ref := range []string{
		"https://attacker.example/keys/money-kek/" + v1,
		"https://kv-other.vault.azure.net/keys/money-kek/" + v1,
		testVault + "/keys/other-kek/" + v1,
		testVault + "/keys/money-kek",
		testVault + "/keys/money-kek/" + v1 + "?x=1",
	} {
		if _, err := p.DecryptDataKey(ctx, wrapped, ref, ctxA); err == nil {
			t.Errorf("%s: expected refusal", ref)
		}
	}
	if len(kv.unwraps) != 0 {
		t.Fatalf("no request should have reached Key Vault, got %v", kv.unwraps)
	}
}

func TestKeyVaultKeyIDs(t *testing.T) {
	for _, ok := range []string{
		"https://kv-money.vault.azure.net/keys/money-kek",
		"https://kv-money.vault.azure.net/keys/money-kek/" + v1,
		"https://hsm-sagolik.managedhsm.azure.net/keys/money-kek",
	} {
		if _, _, _, err := ParseKeyVaultKeyID(ok); err != nil {
			t.Errorf("%s: %v", ok, err)
		}
	}
	for _, bad := range []string{
		"", "alias/sagolik-money", "http://kv-money.vault.azure.net/keys/money-kek",
		"https://kv-money.vault.azure.net/secrets/money-kek", "https://kv-money.vault.azure.net/keys/money-kek/latest",
		"https://evil.com/keys/money-kek", "https://user@kv-money.vault.azure.net/keys/money-kek",
	} {
		if _, _, _, err := ParseKeyVaultKeyID(bad); err == nil {
			t.Errorf("%q: expected refusal", bad)
		}
	}
}
