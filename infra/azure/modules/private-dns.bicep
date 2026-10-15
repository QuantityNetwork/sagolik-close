// Private DNS zones for the private endpoints, linked to the network, so the
// services' usual host names resolve to private addresses inside it.

param zones array
param vnetId string
param tags object

resource zone 'Microsoft.Network/privateDnsZones@2024-06-01' = [
  for name in zones: {
    name: name
    location: 'global'
    tags: tags
  }
]

resource link 'Microsoft.Network/privateDnsZones/virtualNetworkLinks@2024-06-01' = [
  for (name, i) in zones: {
    parent: zone[i]
    name: 'spoke'
    location: 'global'
    tags: tags
    properties: {
      registrationEnabled: false
      virtualNetwork: {
        id: vnetId
      }
    }
  }
]

output ids object = toObject(zones, name => name, name => resourceId('Microsoft.Network/privateDnsZones', name))
