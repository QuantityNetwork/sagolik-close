// Container Registry (Premium). No admin user and no anonymous pull: the
// workloads pull with their managed identities over the private endpoint.
// The registry accepts no public traffic except from addresses the deploy
// pipeline adds for the length of a push (default deny, no standing rules).

param name string
param location string
param zoneRedundant bool
param workspaceId string
param subnetId string
param dnsZoneId string
param tags object
@description('The deploy pipeline\'s identity, allowed to push images (empty: none).')
param pusherPrincipalId string = ''

resource registry 'Microsoft.ContainerRegistry/registries@2023-07-01' = {
  name: name
  location: location
  tags: tags
  sku: {
    name: 'Premium'
  }
  properties: {
    adminUserEnabled: false
    dataEndpointEnabled: true
    publicNetworkAccess: 'Enabled'
    networkRuleBypassOptions: 'AzureServices'
    networkRuleSet: {
      defaultAction: 'Deny'
      ipRules: []
    }
    zoneRedundancy: zoneRedundant ? 'Enabled' : 'Disabled'
    policies: {
      retentionPolicy: {
        status: 'enabled'
        days: 30
      }
    }
  }
}

module endpoint 'private-endpoint.bicep' = {
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
output name string = registry.name
output loginServer string = registry.properties.loginServer
