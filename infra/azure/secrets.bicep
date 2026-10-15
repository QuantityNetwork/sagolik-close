// Puts the environment's secrets into its Key Vaults. Run by an operator (see
// scripts/set-secrets.sh), never by the pipeline: the vaults have no public
// access, so the values go through Azure Resource Manager, and they are never
// stored in GitHub or in deployment history (secure parameters). Empty values
// are skipped, so secrets can be added in several runs.

param coreVaultName string
param moneyVaultName string = ''

// Expiry is a rotation reminder (Key Vault still serves an expired secret, and
// Defender for Cloud flags secrets near expiry); certificates last 397 days.
param now string = utcNow()
var expires = dateTimeToEpoch(dateTimeAdd(now, 'P1Y'))

@secure()
param sessionSecret string = ''
@secure()
param dataKeysWrapped string = ''
@secure()
param dataKekId string = ''
@secure()
param chainDealSalt string = ''
@secure()
param chainRecorderKeyId string = ''

// The money service's mutual TLS and assertion material (cmd/devcerts).
@secure()
param moneyCa string = ''
@secure()
param webClientCert string = ''
@secure()
param webClientKey string = ''
@secure()
param workerClientCert string = ''
@secure()
param workerClientKey string = ''
@secure()
param assertionSigningJwk string = ''
@secure()
param moneyServerCert string = ''
@secure()
param moneyServerKey string = ''
@secure()
param moneyAssertionJwks string = ''
@secure()
param plaidSecret string = ''

resource coreVault 'Microsoft.KeyVault/vaults@2024-11-01' existing = {
  name: coreVaultName
}

resource moneyVault 'Microsoft.KeyVault/vaults@2024-11-01' existing = if (!empty(moneyVaultName)) {
  name: empty(moneyVaultName) ? 'unused' : moneyVaultName
}

var core = filter(
  [
    { name: 'session-secret', value: sessionSecret, type: 'text/plain' }
    { name: 'data-keys-wrapped', value: dataKeysWrapped, type: 'text/plain' }
    { name: 'data-kek-id', value: dataKekId, type: 'text/plain' }
    { name: 'chain-deal-salt', value: chainDealSalt, type: 'text/plain' }
    { name: 'chain-recorder-key-id', value: chainRecorderKeyId, type: 'text/plain' }
    { name: 'money-ca', value: moneyCa, type: 'application/x-pem-file' }
    { name: 'web-client-cert', value: webClientCert, type: 'application/x-pem-file' }
    { name: 'web-client-key', value: webClientKey, type: 'application/x-pem-file' }
    { name: 'worker-client-cert', value: workerClientCert, type: 'application/x-pem-file' }
    { name: 'worker-client-key', value: workerClientKey, type: 'application/x-pem-file' }
    { name: 'assertion-signing-jwk', value: assertionSigningJwk, type: 'application/jwk+json' }
  ],
  s => !empty(s.value)
)

var money = empty(moneyVaultName)
  ? []
  : filter(
      [
        { name: 'money-server-cert', value: moneyServerCert, type: 'application/x-pem-file' }
        { name: 'money-server-key', value: moneyServerKey, type: 'application/x-pem-file' }
        { name: 'money-ca', value: moneyCa, type: 'application/x-pem-file' }
        { name: 'money-assertion-jwks', value: moneyAssertionJwks, type: 'application/jwk-set+json' }
        { name: 'plaid-secret', value: plaidSecret, type: 'text/plain' }
      ],
      s => !empty(s.value)
    )

resource coreSecrets 'Microsoft.KeyVault/vaults/secrets@2024-11-01' = [
  for s in core: {
    parent: coreVault
    name: s.name
    properties: {
      value: s.value
      contentType: s.type
      attributes: {
        enabled: true
        exp: expires
      }
    }
  }
]

resource moneySecrets 'Microsoft.KeyVault/vaults/secrets@2024-11-01' = [
  for s in money: {
    parent: moneyVault
    name: s.name
    properties: {
      value: s.value
      contentType: s.type
      attributes: {
        enabled: true
        exp: expires
      }
    }
  }
]

