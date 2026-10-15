// Least-privilege access for each workload identity, scoped to the exact key,
// container or registry it uses. Nothing here grants management rights.
//
//   web     data-kek: wrap/unwrap        core vault secrets   documents   pull
//   worker  data-kek, chain-recorder     core vault secrets   documents   pull
//   migrate (demo environments only: data-kek, secrets, documents, to load demo data)        pull
//   money   money-kek: wrap/unwrap       money vault secrets              pull
//   money-migrate                                                         pull

param coreVaultName string
param moneyVaultName string // empty without the money service
param storageName string
param registryName string
param principals object // { web, worker, migrate, money?, moneyMigrate? } principal ids
param demoData bool

var roles = {
  acrPull: subscriptionResourceId('Microsoft.Authorization/roleDefinitions', '7f951dda-4ed3-4680-a7ca-43fe172d538d')
  cryptoUser: subscriptionResourceId('Microsoft.Authorization/roleDefinitions', '12338af0-0e69-4776-bea7-57ae8d297424')
  secretsUser: subscriptionResourceId('Microsoft.Authorization/roleDefinitions', '4633458b-17de-408a-b874-0445c86b69e6')
  blobContributor: subscriptionResourceId('Microsoft.Authorization/roleDefinitions', 'ba92f5b4-2d11-453d-a403-e96b0029c9fe')
}

var core = concat([principals.web, principals.worker], demoData ? [principals.migrate] : [])
var pullers = concat(
  [principals.web, principals.worker, principals.migrate],
  empty(moneyVaultName) ? [] : [principals.money, principals.moneyMigrate]
)

resource coreVault 'Microsoft.KeyVault/vaults@2024-11-01' existing = {
  name: coreVaultName
}

resource dataKek 'Microsoft.KeyVault/vaults/keys@2024-11-01' existing = {
  parent: coreVault
  name: 'data-kek'
}

resource chainRecorder 'Microsoft.KeyVault/vaults/keys@2024-11-01' existing = {
  parent: coreVault
  name: 'chain-recorder'
}

resource storage 'Microsoft.Storage/storageAccounts@2024-01-01' existing = {
  name: storageName
}

resource blobs 'Microsoft.Storage/storageAccounts/blobServices@2024-01-01' existing = {
  parent: storage
  name: 'default'
}

resource documents 'Microsoft.Storage/storageAccounts/blobServices/containers@2024-01-01' existing = {
  parent: blobs
  name: 'documents'
}

resource registry 'Microsoft.ContainerRegistry/registries@2023-07-01' existing = {
  name: registryName
}

func assignment(principalId string, roleId string) object => {
  principalId: principalId
  principalType: 'ServicePrincipal'
  roleDefinitionId: roleId
}

resource dataKekUse 'Microsoft.Authorization/roleAssignments@2022-04-01' = [
  for p in core: {
    scope: dataKek
    name: guid(dataKek.id, p, roles.cryptoUser)
    properties: assignment(p, roles.cryptoUser)
  }
]

resource recorderUse 'Microsoft.Authorization/roleAssignments@2022-04-01' = {
  scope: chainRecorder
  name: guid(chainRecorder.id, principals.worker, roles.cryptoUser)
  properties: assignment(principals.worker, roles.cryptoUser)
}

resource coreSecrets 'Microsoft.Authorization/roleAssignments@2022-04-01' = [
  for p in core: {
    scope: coreVault
    name: guid(coreVault.id, p, roles.secretsUser)
    properties: assignment(p, roles.secretsUser)
  }
]

resource documentAccess 'Microsoft.Authorization/roleAssignments@2022-04-01' = [
  for p in core: {
    scope: documents
    name: guid(documents.id, p, roles.blobContributor)
    properties: assignment(p, roles.blobContributor)
  }
]

resource pull 'Microsoft.Authorization/roleAssignments@2022-04-01' = [
  for p in pullers: {
    scope: registry
    name: guid(registry.id, p, roles.acrPull)
    properties: assignment(p, roles.acrPull)
  }
]

resource moneyVault 'Microsoft.KeyVault/vaults@2024-11-01' existing = if (!empty(moneyVaultName)) {
  name: empty(moneyVaultName) ? 'unused' : moneyVaultName
}

resource moneyKek 'Microsoft.KeyVault/vaults/keys@2024-11-01' existing = if (!empty(moneyVaultName)) {
  parent: moneyVault
  name: 'money-kek'
}

resource moneyKekUse 'Microsoft.Authorization/roleAssignments@2022-04-01' = if (!empty(moneyVaultName)) {
  scope: moneyKek
  name: guid(moneyKek.id, principals.?money ?? '', roles.cryptoUser)
  properties: assignment(principals.?money ?? '', roles.cryptoUser)
}

resource moneySecrets 'Microsoft.Authorization/roleAssignments@2022-04-01' = if (!empty(moneyVaultName)) {
  scope: moneyVault
  name: guid(moneyVault.id, principals.?money ?? '', roles.secretsUser)
  properties: assignment(principals.?money ?? '', roles.secretsUser)
}
