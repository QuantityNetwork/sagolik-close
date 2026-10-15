// A Key Vault (Premium: HSM-backed keys) reachable only over its private
// endpoint, with Entra RBAC instead of access policies and purge protection.
// Keys are generated inside the HSM and are never exportable.

param name string
param location string
param keys array // [{ name, kty, keySize?, curveName?, keyOps }]
param workspaceId string
param subnetId string
param dnsZoneId string
param lock bool
param tags object

resource vault 'Microsoft.KeyVault/vaults@2024-11-01' = {
  name: name
  location: location
  tags: tags
  properties: {
    tenantId: tenant().tenantId
    sku: {
      family: 'A'
      name: 'premium'
    }
    enableRbacAuthorization: true
    enableSoftDelete: true
    softDeleteRetentionInDays: 90
    enablePurgeProtection: true
    enabledForDeployment: false
    enabledForDiskEncryption: false
    enabledForTemplateDeployment: false
    publicNetworkAccess: 'Disabled'
    networkAcls: {
      defaultAction: 'Deny'
      // Trusted Azure services only, e.g. Blob Storage using its customer-managed key.
      bypass: 'AzureServices'
    }
  }
}

// Creating a key through Azure Resource Manager is idempotent: a redeployment
// never adds a version. New versions are a deliberate rotation (see the runbook).
resource key 'Microsoft.KeyVault/vaults/keys@2024-11-01' = [
  for k in keys: {
    parent: vault
    name: k.name
    properties: {
      kty: k.kty
      keySize: k.?keySize
      curveName: k.?curveName
      keyOps: k.keyOps
      attributes: {
        enabled: true
      }
    }
  }
]

module endpoint 'private-endpoint.bicep' = {
  name: '${name}-pe'
  params: {
    name: 'pe-${name}'
    location: location
    subnetId: subnetId
    serviceId: vault.id
    groupId: 'vault'
    dnsZoneId: dnsZoneId
    tags: tags
  }
}

resource diagnostics 'Microsoft.Insights/diagnosticSettings@2021-05-01-preview' = {
  scope: vault
  name: 'to-log-analytics'
  properties: {
    workspaceId: workspaceId
    logAnalyticsDestinationType: 'Dedicated'
    logs: [
      {
        categoryGroup: 'allLogs'
        enabled: true
      }
    ]
    metrics: [
      {
        category: 'AllMetrics'
        enabled: true
      }
    ]
  }
}

resource deleteLock 'Microsoft.Authorization/locks@2020-05-01' = if (lock) {
  scope: vault
  name: 'do-not-delete'
  properties: {
    level: 'CanNotDelete'
    notes: 'Holds the keys that protect production data.'
  }
}

output id string = vault.id
output name string = vault.name
output uri string = vault.properties.vaultUri
output keys object = toObject(
  range(0, length(keys)),
  i => keys[i].name,
  i => {
    id: '${vault.properties.vaultUri}keys/${keys[i].name}'
  }
)
