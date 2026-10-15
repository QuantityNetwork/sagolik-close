// The subscription's Activity Log (who changed what in Azure) into the workspace.
targetScope = 'subscription'

param name string
param workspaceId string

resource activity 'Microsoft.Insights/diagnosticSettings@2021-05-01-preview' = {
  name: name
  properties: {
    workspaceId: workspaceId
    logs: [
      for category in ['Administrative', 'Security', 'ServiceHealth', 'Alert', 'Recommendation', 'Policy', 'Autoscale', 'ResourceHealth']: {
        category: category
        enabled: true
      }
    ]
  }
}
