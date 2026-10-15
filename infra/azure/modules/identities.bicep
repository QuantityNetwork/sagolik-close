// One user-assigned managed identity per workload. Nothing signs in with a
// secret: each identity gets only the roles it needs, on the specific key,
// container or registry (rbac.bicep), and database access is granted to its
// database role by the migrate jobs.

param prefix string
param location string
param moneyService bool
param tags object

resource web 'Microsoft.ManagedIdentity/userAssignedIdentities@2023-01-31' = {
  name: 'id-${prefix}-web'
  location: location
  tags: tags
}

resource worker 'Microsoft.ManagedIdentity/userAssignedIdentities@2023-01-31' = {
  name: 'id-${prefix}-worker'
  location: location
  tags: tags
}

// Entra administrator of the app database. Used only by the migrate job.
resource migrate 'Microsoft.ManagedIdentity/userAssignedIdentities@2023-01-31' = {
  name: 'id-${prefix}-migrate'
  location: location
  tags: tags
}

// The storage account's own identity, for its customer-managed key.
resource storage 'Microsoft.ManagedIdentity/userAssignedIdentities@2023-01-31' = {
  name: 'id-${prefix}-storage'
  location: location
  tags: tags
}

resource money 'Microsoft.ManagedIdentity/userAssignedIdentities@2023-01-31' = if (moneyService) {
  name: 'id-${prefix}-money'
  location: location
  tags: tags
}

// Entra administrator of the money database. Used only by the money migrate job.
resource moneyMigrate 'Microsoft.ManagedIdentity/userAssignedIdentities@2023-01-31' = if (moneyService) {
  name: 'id-${prefix}-money-migrate'
  location: location
  tags: tags
}

func describe(id string, name string, clientId string, principalId string) object => {
  id: id
  name: name
  clientId: clientId
  principalId: principalId
}

output web object = describe(web.id, web.name, web.properties.clientId, web.properties.principalId)
output worker object = describe(worker.id, worker.name, worker.properties.clientId, worker.properties.principalId)
output migrate object = describe(migrate.id, migrate.name, migrate.properties.clientId, migrate.properties.principalId)
output storage object = describe(storage.id, storage.name, storage.properties.clientId, storage.properties.principalId)
output money object = moneyService ? describe(money.id, money.name, money!.properties.clientId, money!.properties.principalId) : {}
output moneyMigrate object = moneyService
  ? describe(moneyMigrate.id, moneyMigrate.name, moneyMigrate!.properties.clientId, moneyMigrate!.properties.principalId)
  : {}
