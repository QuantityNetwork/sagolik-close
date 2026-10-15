// Azure Firewall: the only way out of the network. Each environment may reach
// only the platform's own dependencies and the providers it uses, by name.

param prefix string
param location string
param subnetId string
param sources object // { core: '<cidr>', money: '<cidr>' }
param coreDestinations array
param moneyDestinations array
param workspaceId string
param tags object

resource ip 'Microsoft.Network/publicIPAddresses@2024-05-01' = {
  name: 'pip-${prefix}-fw'
  location: location
  tags: tags
  sku: {
    name: 'Standard'
  }
  zones: ['1', '2', '3']
  properties: {
    publicIPAllocationMethod: 'Static'
    publicIPAddressVersion: 'IPv4'
  }
}

resource policy 'Microsoft.Network/firewallPolicies@2024-05-01' = {
  name: 'afwp-${prefix}'
  location: location
  tags: tags
  properties: {
    sku: {
      tier: 'Standard'
    }
    threatIntelMode: 'Deny'
    dnsSettings: {
      enableProxy: true
    }
  }
}

func https(name string, source string, fqdns array) object => {
  ruleType: 'ApplicationRule'
  name: name
  protocols: [
    {
      protocolType: 'Https'
      port: 443
    }
  ]
  sourceAddresses: [source]
  targetFqdns: fqdns
}

resource rules 'Microsoft.Network/firewallPolicies/ruleCollectionGroups@2024-05-01' = {
  parent: policy
  name: 'egress'
  properties: {
    priority: 200
    ruleCollections: [
      {
        ruleCollectionType: 'FirewallPolicyFilterRuleCollection'
        name: 'platform'
        priority: 100
        action: {
          type: 'Allow'
        }
        rules: [
          {
            // Container Apps' own dependencies: images, managed identity tokens, logs.
            ruleType: 'NetworkRule'
            name: 'azure-platform'
            ipProtocols: ['TCP']
            sourceAddresses: [sources.core, sources.money]
            destinationAddresses: ['AzureActiveDirectory', 'AzureMonitor', 'MicrosoftContainerRegistry', 'AzureFrontDoor.FirstParty']
            destinationPorts: ['443']
          }
        ]
      }
      {
        ruleCollectionType: 'FirewallPolicyFilterRuleCollection'
        name: 'providers'
        priority: 200
        action: {
          type: 'Allow'
        }
        rules: concat(
          empty(coreDestinations) ? [] : [https('core', sources.core, coreDestinations)],
          empty(moneyDestinations) ? [] : [https('money', sources.money, moneyDestinations)]
        )
      }
    ]
  }
}

resource firewall 'Microsoft.Network/azureFirewalls@2024-05-01' = {
  name: 'afw-${prefix}'
  location: location
  tags: tags
  zones: ['1', '2', '3']
  dependsOn: [rules]
  properties: {
    sku: {
      name: 'AZFW_VNet'
      tier: 'Standard'
    }
    firewallPolicy: {
      id: policy.id
    }
    ipConfigurations: [
      {
        name: 'egress'
        properties: {
          subnet: {
            id: subnetId
          }
          publicIPAddress: {
            id: ip.id
          }
        }
      }
    ]
  }
}

resource diagnostics 'Microsoft.Insights/diagnosticSettings@2021-05-01-preview' = {
  scope: firewall
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

output privateIp string = firewall.properties.ipConfigurations[0].properties.privateIPAddress
output egressIp string = ip.properties.ipAddress
