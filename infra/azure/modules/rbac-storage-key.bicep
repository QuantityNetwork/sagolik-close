// The storage account's identity may use only the storage-cmk key, and only to
// wrap and unwrap the account's encryption key. Must exist before the account.

param vaultName string
param principalId string

resource vault 'Microsoft.KeyVault/vaults@2024-11-01' existing = {
  name: vaultName
}

resource key 'Microsoft.KeyVault/vaults/keys@2024-11-01' existing = {
  parent: vault
  name: 'storage-cmk'
}

var serviceEncryptionUser = subscriptionResourceId('Microsoft.Authorization/roleDefinitions', 'e147488a-f6f5-4113-8e2d-b22465e65bf6')

resource use 'Microsoft.Authorization/roleAssignments@2022-04-01' = {
  scope: key
  name: guid(key.id, principalId, serviceEncryptionUser)
  properties: {
    principalId: principalId
    principalType: 'ServicePrincipal'
    roleDefinitionId: serviceEncryptionUser
  }
}
