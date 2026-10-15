// Guard rails on the resource group: resources only in the approved region,
// and a monthly budget with alerts.

param location string
param budget object // { amount, contactEmails, startDate }

resource allowedLocations 'Microsoft.Authorization/policyAssignments@2024-04-01' = {
  name: 'allowed-locations'
  properties: {
    displayName: 'Resources only in ${location}'
    // Built-in policy "Allowed locations".
    policyDefinitionId: tenantResourceId('Microsoft.Authorization/policyDefinitions', 'e56962a6-4747-49cd-b67b-bf8b01975c4c')
    parameters: {
      listOfAllowedLocations: {
        value: [location, 'global']
      }
    }
    enforcementMode: 'Default'
  }
}

resource monthly 'Microsoft.Consumption/budgets@2023-11-01' = if (budget.amount > 0) {
  name: 'monthly'
  properties: {
    category: 'Cost'
    amount: budget.amount
    timeGrain: 'Monthly'
    timePeriod: {
      startDate: budget.startDate
    }
    notifications: {
      actual80: {
        enabled: true
        operator: 'GreaterThan'
        threshold: 80
        thresholdType: 'Actual'
        contactRoles: ['Owner']
        contactEmails: budget.contactEmails
      }
      forecast100: {
        enabled: true
        operator: 'GreaterThan'
        threshold: 100
        thresholdType: 'Forecasted'
        contactRoles: ['Owner']
        contactEmails: budget.contactEmails
      }
    }
  }
}
