// Log Analytics: every resource's diagnostics, the container logs and the
// Activity Log land here; Microsoft Sentinel runs on top of it.

param name string
param location string
param retentionDays int
param enableSentinel bool
param tags object

resource workspace 'Microsoft.OperationalInsights/workspaces@2023-09-01' = {
  name: name
  location: location
  tags: tags
  properties: {
    sku: {
      name: 'PerGB2018'
    }
    retentionInDays: retentionDays
    features: {
      // Access follows the permissions on each resource, not the whole workspace.
      enableLogAccessUsingOnlyResourcePermissions: true
      disableLocalAuth: true
    }
  }
}

resource sentinel 'Microsoft.SecurityInsights/onboardingStates@2024-03-01' = if (enableSentinel) {
  scope: workspace
  name: 'default'
  properties: {}
}

output id string = workspace.id
output name string = workspace.name
