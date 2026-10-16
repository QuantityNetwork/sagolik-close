// The spoke network. Each workload environment has its own subnet; private
// endpoints sit in separate subnets per trust zone, and network security
// groups allow only the flows the design needs:
//   core -> core private endpoints (Key Vault, PostgreSQL, Blob), 443/5432
//   money -> money private endpoints (Key Vault, PostgreSQL), 443/5432
//   core and money -> the registry's private endpoint, 443
//   core -> money API, 8443 (mutual TLS)
// Everything else between subnets is denied. Egress leaves through Azure
// Firewall (FQDN allow-list) or, where that's off, a NAT gateway.

param prefix string
param location string
param addressSpace string
param egressFirewall bool
@description('Lean development profile: the core environment has a public address, so HTTPS may come in from the internet.')
param publicCore bool = false
var natGateway = true
param tags object

var subnets = {
  core: cidrSubnet(addressSpace, 23, 0)
  money: cidrSubnet(addressSpace, 23, 1)
  peCore: cidrSubnet(addressSpace, 26, 16)
  peMoney: cidrSubnet(addressSpace, 26, 17)
  peShared: cidrSubnet(addressSpace, 26, 18)
  firewall: cidrSubnet(addressSpace, 26, 20)
}
// Azure Firewall takes the first usable address of its subnet.
var firewallPrivateIp = cidrHost(subnets.firewall, 3)

var denyOtherVnetInbound = {
  name: 'DenyOtherVnetInbound'
  properties: {
    priority: 4000
    direction: 'Inbound'
    access: 'Deny'
    protocol: '*'
    sourceAddressPrefix: 'VirtualNetwork'
    sourcePortRange: '*'
    destinationAddressPrefix: '*'
    destinationPortRange: '*'
  }
}

func allow(name string, priority int, protocol string, source array, destination string, ports array) object => {
  name: name
  properties: {
    priority: priority
    direction: 'Inbound'
    access: 'Allow'
    protocol: protocol
    sourceAddressPrefixes: source
    sourcePortRange: '*'
    destinationAddressPrefix: destination
    destinationPortRanges: ports
  }
}

var loadBalancer = {
  name: 'AllowAzureLoadBalancer'
  properties: {
    priority: 120
    direction: 'Inbound'
    access: 'Allow'
    protocol: '*'
    sourceAddressPrefix: 'AzureLoadBalancer'
    sourcePortRange: '*'
    destinationAddressPrefix: '*'
    destinationPortRange: '*'
  }
}

var nsgRules = {
  core: concat(
    [
      // The environment's own infrastructure, including Front Door's Private Link connection.
      allow('AllowWithinCore', 100, '*', [subnets.core], subnets.core, ['0-65535'])
      loadBalancer
      denyOtherVnetInbound
    ],
    publicCore
      ? [
          {
            name: 'AllowHttpsFromInternet'
            properties: {
              priority: 130
              direction: 'Inbound'
              access: 'Allow'
              protocol: 'Tcp'
              sourceAddressPrefix: 'Internet'
              sourcePortRange: '*'
              destinationAddressPrefix: subnets.core
              destinationPortRanges: ['80', '443']
            }
          }
        ]
      : []
  )
  money: [
    allow('AllowCoreToMoneyApi', 100, 'Tcp', [subnets.core], subnets.money, ['8443'])
    allow('AllowWithinMoney', 110, '*', [subnets.money], subnets.money, ['0-65535'])
    loadBalancer
    denyOtherVnetInbound
  ]
  peCore: [
    allow('AllowCoreToCoreData', 100, 'Tcp', [subnets.core], subnets.peCore, ['443', '5432'])
    denyOtherVnetInbound
  ]
  peMoney: [
    allow('AllowMoneyToMoneyData', 100, 'Tcp', [subnets.money], subnets.peMoney, ['443', '5432'])
    denyOtherVnetInbound
  ]
  peShared: [
    allow('AllowAppsToRegistry', 100, 'Tcp', [subnets.core, subnets.money], subnets.peShared, ['443'])
    denyOtherVnetInbound
  ]
}

resource nsgs 'Microsoft.Network/networkSecurityGroups@2024-05-01' = [
  for zone in items(nsgRules): {
    name: 'nsg-${prefix}-${zone.key}'
    location: location
    tags: tags
    properties: {
      securityRules: zone.value
    }
  }
]

resource natIp 'Microsoft.Network/publicIPAddresses@2024-05-01' = if (!egressFirewall && natGateway) {
  name: 'pip-${prefix}-nat'
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

resource nat 'Microsoft.Network/natGateways@2024-05-01' = if (!egressFirewall && natGateway) {
  name: 'ng-${prefix}'
  location: location
  tags: tags
  sku: {
    name: 'Standard'
  }
  properties: {
    idleTimeoutInMinutes: 10
    publicIpAddresses: [
      {
        id: natIp.id
      }
    ]
  }
}

resource routes 'Microsoft.Network/routeTables@2024-05-01' = if (egressFirewall) {
  name: 'rt-${prefix}-egress'
  location: location
  tags: tags
  properties: {
    disableBgpRoutePropagation: true
    routes: [
      {
        name: 'internet-through-firewall'
        properties: {
          addressPrefix: '0.0.0.0/0'
          nextHopType: 'VirtualAppliance'
          nextHopIpAddress: firewallPrivateIp
        }
      }
    ]
  }
}

var nsgIndex = {
  core: 0
  money: 1
  peCore: 2
  peMoney: 3
  peShared: 4
}

var egress = egressFirewall ? { routeTable: { id: routes.id } } : natGateway ? { natGateway: { id: nat.id } } : {}

func appSubnet(name string, prefix string, nsgId string, egress object) object => {
  name: name
  properties: union(
    {
      addressPrefix: prefix
      networkSecurityGroup: {
        id: nsgId
      }
      delegations: [
        {
          name: 'container-apps'
          properties: {
            serviceName: 'Microsoft.App/environments'
          }
        }
      ]
      privateEndpointNetworkPolicies: 'Disabled'
    },
    egress
  )
}

func endpointSubnet(name string, prefix string, nsgId string) object => {
  name: name
  properties: {
    addressPrefix: prefix
    networkSecurityGroup: {
      id: nsgId
    }
    // Network security groups apply to the private endpoints in these subnets.
    privateEndpointNetworkPolicies: 'Enabled'
  }
}

resource vnet 'Microsoft.Network/virtualNetworks@2024-05-01' = {
  name: 'vnet-${prefix}'
  location: location
  tags: tags
  properties: {
    addressSpace: {
      addressPrefixes: [addressSpace]
    }
    subnets: concat(
      [
        appSubnet('snet-core', subnets.core, nsgs[nsgIndex.core].id, egress)
        appSubnet('snet-money', subnets.money, nsgs[nsgIndex.money].id, egress)
        endpointSubnet('snet-pe-core', subnets.peCore, nsgs[nsgIndex.peCore].id)
        endpointSubnet('snet-pe-money', subnets.peMoney, nsgs[nsgIndex.peMoney].id)
        endpointSubnet('snet-pe-shared', subnets.peShared, nsgs[nsgIndex.peShared].id)
      ],
      egressFirewall
        ? [
            {
              name: 'AzureFirewallSubnet'
              properties: {
                addressPrefix: subnets.firewall
              }
            }
          ]
        : []
    )
  }
}

output vnetId string = vnet.id
output prefixes object = subnets
output subnetIds object = {
  core: resourceId('Microsoft.Network/virtualNetworks/subnets', vnet.name, 'snet-core')
  money: resourceId('Microsoft.Network/virtualNetworks/subnets', vnet.name, 'snet-money')
  peCore: resourceId('Microsoft.Network/virtualNetworks/subnets', vnet.name, 'snet-pe-core')
  peMoney: resourceId('Microsoft.Network/virtualNetworks/subnets', vnet.name, 'snet-pe-money')
  peShared: resourceId('Microsoft.Network/virtualNetworks/subnets', vnet.name, 'snet-pe-shared')
  firewall: egressFirewall ? resourceId('Microsoft.Network/virtualNetworks/subnets', vnet.name, 'AzureFirewallSubnet') : ''
}
output egressIp string = egressFirewall || !natGateway ? '' : natIp!.properties.ipAddress
