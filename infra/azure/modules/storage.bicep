// The document vault: Blob Storage with Entra-only access (no account keys),
// no public access (private endpoint), encryption with a customer-managed key
// from Key Vault on top of infrastructure encryption, versioning and soft
// delete. Object keys are content-addressed and written once by the app.

param name string
param location string
param skuName string
param identityId string
param keyVaultUri string
param keyName string
param workspaceId string
param subnetId string
param dnsZoneId string
param retentionDays int
param lock bool
param tags object

resource account 'Microsoft.Storage/storageAccounts@2024-01-01' = {
  name: name
  location: location
  tags: tags
  kind: 'StorageV2'
  sku: {
    name: skuName
  }
  identity: {
    type: 'UserAssigned'
    userAssignedIdentities: {
      '${identityId}': {}
    }
  }
  properties: {
    accessTier: 'Hot'
    allowBlobPublicAccess: false
    allowSharedKeyAccess: false
    allowCrossTenantReplication: false
    defaultToOAuthAuthentication: true
    minimumTlsVersion: 'TLS1_2'
    supportsHttpsTrafficOnly: true
    publicNetworkAccess: 'Disabled'
    networkAcls: {
      defaultAction: 'Deny'
      bypass: 'AzureServices'
    }
    encryption: {
      keySource: 'Microsoft.Keyvault'
      requireInfrastructureEncryption: true
      identity: {
        userAssignedIdentity: identityId
      }
      keyvaultproperties: {
        keyname: keyName
        keyvaulturi: keyVaultUri
      }
      services: {
        blob: {
          enabled: true
          keyType: 'Account'
        }
        file: {
          enabled: true
          keyType: 'Account'
        }
      }
    }
  }
}

resource blobs 'Microsoft.Storage/storageAccounts/blobServices@2024-01-01' = {
  parent: account
  name: 'default'
  properties: {
    isVersioningEnabled: true
    changeFeed: {
      enabled: true
      retentionInDays: retentionDays
    }
    deleteRetentionPolicy: {
      enabled: true
      days: retentionDays
    }
    containerDeleteRetentionPolicy: {
      enabled: true
      days: retentionDays
    }
  }
}

resource documents 'Microsoft.Storage/storageAccounts/blobServices/containers@2024-01-01' = {
  parent: blobs
  name: 'documents'
  properties: {
    publicAccess: 'None'
  }
}

module endpoint 'private-endpoint.bicep' = {
  name: '${name}-pe'
  params: {
    name: 'pe-${name}-blob'
    location: location
    subnetId: subnetId
    serviceId: account.id
    groupId: 'blob'
    dnsZoneId: dnsZoneId
    tags: tags
  }
}

resource diagnostics 'Microsoft.Insights/diagnosticSettings@2021-05-01-preview' = {
  scope: blobs
  name: 'to-log-analytics'
  properties: {
    workspaceId: workspaceId
    logs: [
      {
        categoryGroup: 'allLogs'
        enabled: true
      }
    ]
    metrics: [
      {
        category: 'Transaction'
        enabled: true
      }
    ]
  }
}

resource deleteLock 'Microsoft.Authorization/locks@2020-05-01' = if (lock) {
  scope: account
  name: 'do-not-delete'
  properties: {
    level: 'CanNotDelete'
    notes: 'Holds the document vault.'
  }
}

output id string = account.id
output name string = account.name
output blobUrl string = account.properties.primaryEndpoints.blob
output documentsContainerId string = documents.id
