// Container Registry. No admin user and no anonymous pull: the workloads pull
// with their managed identities.
//   Premium: over a private endpoint; no public traffic except from addresses
//            the deploy pipeline adds for the length of a push.
//   Basic:   the lean development profile (fictional data only): public, still
//            Entra-only, no private endpoint (Basic has none).

param name string
param location string
param zoneRedundant bool
param workspaceId string
param subnetId string
param dnsZoneId string
param tags object
@allowed(['Premium', 'Basic'])
param sku string = 'Premium'
@description('The deploy pipeline\'s identity, allowed to push images (empty: none).')
param pusherPrincipalId string = ''

var premium = sku == 'Premium'

resource registry 'Microsoft.ContainerRegistry/registries@2023-07-01' = {
  name: name
  location: location
  tags: tags
  sku: {
    name: sku
  }
  properties: {
    adminUserEnabled: false
    dataEndpointEnabled: premium
    publicNetworkAccess: 'Enabled'
    networkRuleBypassOptions: 'AzureServices'
    // Network rules exist on Premium only; Basic (lean) is public, still Entra-only.
    networkRuleSet: premium
      ? {
          defaultAction: 'Deny'
          ipRules: []
        }
      : null
    zoneRedundancy: premium && zoneRedundant ? 'Enabled' : 'Disabled'
    policies: premium
      ? {
          retentionPolicy: {
            status: 'enabled'
            days: 30
          }
        }
      : {}
  }
}

module endpoint 'private-endpoint.bicep' = if (premium) {
  name: '${name}-pe'
  params: {
    name: 'pe-${name}'
    location: location
    subnetId: subnetId
    serviceId: registry.id
    groupId: 'registry'
    dnsZoneId: dnsZoneId
    tags: tags
  }
}

resource diagnostics 'Microsoft.Insights/diagnosticSettings@2021-05-01-preview' = {
  scope: registry
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

resource push 'Microsoft.Authorization/roleAssignments@2022-04-01' = if (!empty(pusherPrincipalId)) {
  scope: registry
  name: guid(registry.id, pusherPrincipalId, 'AcrPush')
  properties: {
    principalId: pusherPrincipalId
    principalType: 'ServicePrincipal'
    // AcrPush
    roleDefinitionId: subscriptionResourceId('Microsoft.Authorization/roleDefinitions', '8311e382-0749-4cb8-b61a-304f252e45ec')
  }
}

output id string = registry.id
output restricted bool = premium
output name string = registry.name
output loginServer string = registry.properties.loginServer
