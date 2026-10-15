// A Container Apps environment on workload profiles, inside its own subnet,
// with an internal address only and public network access disabled. Front
// Door reaches it over Private Link; traffic between replicas is encrypted.

param name string
param location string
param subnetId string
param zoneRedundant bool
param workloadProfiles array
param workspaceId string
param tags object

resource environment 'Microsoft.App/managedEnvironments@2025-07-01' = {
  name: name
  location: location
  tags: tags
  properties: {
    vnetConfiguration: {
      infrastructureSubnetId: subnetId
      internal: true
    }
    publicNetworkAccess: 'Disabled'
    zoneRedundant: zoneRedundant
    workloadProfiles: workloadProfiles
    appLogsConfiguration: {
      destination: 'azure-monitor'
    }
    peerTrafficConfiguration: {
      encryption: {
        enabled: true
      }
    }
  }
}

resource diagnostics 'Microsoft.Insights/diagnosticSettings@2021-05-01-preview' = {
  scope: environment
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

output id string = environment.id
output name string = environment.name
output defaultDomain string = environment.properties.defaultDomain
output staticIp string = environment.properties.staticIp
