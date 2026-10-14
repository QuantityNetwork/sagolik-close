package keys

import (
	"context"
	"crypto/rand"
	"errors"
	"fmt"
	"net/url"
	"regexp"
	"strings"

	"github.com/Azure/azure-sdk-for-go/sdk/security/keyvault/azkeys"

	"github.com/quantitynetwork/sagolik-close/services/money/internal/redact"
)

// KeyVaultAPI is the subset of the Azure Key Vault keys client this provider uses.
type KeyVaultAPI interface {
	WrapKey(ctx context.Context, name string, version string, parameters azkeys.KeyOperationParameters, options *azkeys.WrapKeyOptions) (azkeys.WrapKeyResponse, error)
	UnwrapKey(ctx context.Context, name string, version string, parameters azkeys.KeyOperationParameters, options *azkeys.UnwrapKeyOptions) (azkeys.UnwrapKeyResponse, error)
}

// AzureKeyVaultProvider wraps data keys with an RSA key held in Azure Key
// Vault (Premium: HSM-backed) or Managed HSM. Each data key is 32 bytes from
// crypto/rand, wrapped with RSA-OAEP-256; the KEK never leaves the HSM and
// Key Vault logs every wrap and unwrap (AuditEvent diagnostics).
//
// Key Vault has no encryption context: the binding to purpose and record
// comes from the value's AES-GCM associated data, which Envelope always sets,
// so a sealed value moved to another row or purpose still fails to open.
//
// Rotation: create a new version of the key in Key Vault. New values wrap
// with the newest version; values sealed earlier name their version in the
// key reference and keep unwrapping with it.
type AzureKeyVaultProvider struct {
	client  KeyVaultAPI
	vault   string // https://<vault>.vault.azure.net
	name    string
	version string // empty: always wrap with the newest version
}

var (
	keyVaultHost = regexp.MustCompile(`^[a-z0-9-]+\.(vault\.azure\.net|managedhsm\.azure\.net)$`)
	keyName      = regexp.MustCompile(`^[A-Za-z0-9-]{1,127}$`)
	keyVersion   = regexp.MustCompile(`^[0-9a-f]{32}$`)
)

// ParseKeyVaultKeyID splits https://<vault>.vault.azure.net/keys/<name>[/<version>].
func ParseKeyVaultKeyID(id string) (vault, name, version string, err error) {
	u, err := url.Parse(id)
	if err != nil || u.Scheme != "https" || !keyVaultHost.MatchString(u.Host) || u.User != nil || u.RawQuery != "" || u.Fragment != "" {
		return "", "", "", fmt.Errorf("keys: %q is not a Key Vault key id (https://<vault>.vault.azure.net/keys/<name>)", id)
	}
	parts := strings.Split(strings.TrimPrefix(u.Path, "/"), "/")
	if len(parts) < 2 || len(parts) > 3 || parts[0] != "keys" || !keyName.MatchString(parts[1]) || (len(parts) == 3 && !keyVersion.MatchString(parts[2])) {
		return "", "", "", fmt.Errorf("keys: %q is not a Key Vault key id (https://<vault>.vault.azure.net/keys/<name>)", id)
	}
	if len(parts) == 3 {
		version = parts[2]
	}
	return "https://" + u.Host, parts[1], version, nil
}

// NewAzureKeyVaultProvider uses the key keyID; the client must be bound to the same vault.
func NewAzureKeyVaultProvider(client KeyVaultAPI, keyID string) (*AzureKeyVaultProvider, error) {
	if client == nil {
		return nil, errors.New("keys: azure key vault provider needs a client")
	}
	vault, name, version, err := ParseKeyVaultKeyID(keyID)
	if err != nil {
		return nil, err
	}
	return &AzureKeyVaultProvider{client: client, vault: vault, name: name, version: version}, nil
}

func (p *AzureKeyVaultProvider) Name() string { return "azurekv" }

// VaultURL is the vault the client must be bound to.
func (p *AzureKeyVaultProvider) VaultURL() string { return p.vault }

func (p *AzureKeyVaultProvider) GenerateDataKey(ctx context.Context, _ Context) ([]byte, []byte, string, error) {
	dek := make([]byte, 32)
	if _, err := rand.Read(dek); err != nil {
		return nil, nil, "", err
	}
	alg := azkeys.EncryptionAlgorithmRSAOAEP256
	resp, err := p.client.WrapKey(ctx, p.name, p.version, azkeys.KeyOperationParameters{Algorithm: &alg, Value: dek}, nil)
	if err != nil {
		redact.Wipe(dek)
		return nil, nil, "", err
	}
	if resp.KID == nil || len(resp.Result) == 0 {
		redact.Wipe(dek)
		return nil, nil, "", errors.New("keys: unexpected WrapKey response")
	}
	// The response names the exact key version used: pin unwrapping to it.
	keyRef := string(*resp.KID)
	if _, _, err := p.ownVersion(keyRef); err != nil {
		redact.Wipe(dek)
		return nil, nil, "", err
	}
	return dek, resp.Result, keyRef, nil
}

func (p *AzureKeyVaultProvider) DecryptDataKey(ctx context.Context, wrapped []byte, keyRef string, _ Context) ([]byte, error) {
	// The reference comes from stored data: only versions of our own key are
	// ever unwrapped, so a tampered value can't send our credentials elsewhere.
	name, version, err := p.ownVersion(keyRef)
	if err != nil {
		return nil, err
	}
	alg := azkeys.EncryptionAlgorithmRSAOAEP256
	resp, err := p.client.UnwrapKey(ctx, name, version, azkeys.KeyOperationParameters{Algorithm: &alg, Value: wrapped}, nil)
	if err != nil {
		return nil, err
	}
	if len(resp.Result) != 32 {
		redact.Wipe(resp.Result)
		return nil, errors.New("keys: unexpected data key length")
	}
	return resp.Result, nil
}

// ownVersion checks that keyRef is a specific version of the configured key.
func (p *AzureKeyVaultProvider) ownVersion(keyRef string) (name, version string, err error) {
	vault, name, version, err := ParseKeyVaultKeyID(keyRef)
	if err != nil || vault != p.vault || name != p.name || version == "" {
		return "", "", fmt.Errorf("keys: key reference %q is not a version of %s/keys/%s", keyRef, p.vault, p.name)
	}
	return name, version, nil
}
