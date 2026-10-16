// Sagolik Close on Azure: one environment (dev or prod) in its own resource
// group, deployed in phases by .github/workflows/deploy-azure.yml:
//   platform  network, keys, databases, storage, registry, environments,
//             Front Door and its WAF
//   ceremony  + the keys job, which wraps the data keys inside the network
//   apps      + the container apps, migrate jobs and Front Door routes, once
//             the operator has put the ceremony's output and the secrets
//             in Key Vault (docs/azure/runbook.md)
// Every phase includes the ones before it. Architecture: docs/azure/architecture.md.
targetScope = 'subscription'

@allowed(['dev', 'prod'])
param environmentName string

@description('Region for everything except the global edge. East US 2 by default (US closings, US data residency).')
param location string = 'eastus2'

@description('Public host name, e.g. close.sagolik.com. Empty: the Front Door endpoint name only.')
param appHostName string = ''

@allowed(['platform', 'ceremony', 'apps'])
param phase string = 'platform'

@description('Image references by digest (registry/name@sha256:...), needed from the ceremony phase on.')
param images object = {
  web: ''
  worker: ''
  money: ''
}

@description('Run the fictional demo environment: sandbox providers, demo sign-in and seeded data. Never in production.')
param demoMode bool = false

@description('The isolated money service (its own environment, database and key vault).')
param moneyService bool = true

@description('Egress through Azure Firewall with an FQDN allow-list (production); otherwise a NAT gateway.')
param egressFirewall bool = false

@description('''
standard: everything in architecture.md. lean: development with fictional data
only, at about $100-150 a month: no Front Door (the web app has its own public
address, optionally limited to allowedClientIps), a Basic registry. Keys, private databases and storage, managed identities and logs stay
the same; outbound still leaves through the NAT gateway. Never for real data; the configuration refuses it with the money
service or the firewall.
''')
@allowed(['standard', 'lean'])
param costProfile string = 'standard'

@description('Lean profile: client addresses (CIDR) allowed to reach the web app. Empty: anyone.')
param allowedClientIps array = []

param addressSpace string = '10.40.0.0/16'

param postgres object = {
  sku: {
    name: 'Standard_B1ms'
    tier: 'Burstable'
  }
  storageSizeGB: 32
  highAvailability: false
  geoRedundantBackup: false
  backupRetentionDays: 7
}

param web object = {
  min: 1
  max: 1
}

@allowed(['Detection', 'Prevention'])
param wafMode string = 'Prevention'

@description('Deal record: network (off | sandbox | base-sepolia | base), JSON-RPC URL and registry address.')
param chain object = {
  network: ''
  rpcUrl: ''
  registry: ''
}

@description('Plaid, through the money service: env (off | sandbox | production) and client id. The secret goes in Key Vault.')
param plaid object = {
  env: 'off'
  clientId: ''
}

param logRetentionDays int = 30
param enableDefender bool = true
param enableSentinel bool = true

@description('Monthly budget in the billing currency (0: none). Alerts go to the subscription\'s owners, plus any addresses listed.')
param budget object = {
  amount: 0
  contactEmails: []
}
param budgetStartDate string = utcNow('yyyy-MM-01')

@description('Object id of the deploy pipeline\'s identity, which pushes images (docs/azure/runbook.md).')
param deployerPrincipalId string = ''

param tags object = {}

var prefix = 'sagolik-${environmentName}'
var lean = costProfile == 'lean'
// The lean profile is for fictional data; it never carries the money service or production.
var leanAllowed = !lean || (!moneyService && !egressFirewall && environmentName != 'prod')
var withCeremony = phase != 'platform'
var withApps = phase == 'apps'
var production = environmentName == 'prod'
var appEnv = production ? 'production' : 'staging'
var unique = take(uniqueString(subscription().subscriptionId, environmentName), 6)
var allTags = union(tags, {
  application: 'sagolik-close'
  environment: environmentName
})

resource group 'Microsoft.Resources/resourceGroups@2024-07-01' = {
  // A refused combination fails here, before anything is created.
  name: leanAllowed ? 'rg-${prefix}' : fail('costProfile lean is for development with fictional data: not with the money service, the firewall or production.')
  location: location
  tags: allTags
}

module monitoring 'modules/monitoring.bicep' = {
  scope: group
  name: 'monitoring'
  params: {
    name: 'log-${prefix}'
    location: location
    retentionDays: logRetentionDays
    enableSentinel: enableSentinel
    tags: allTags
  }
}

module identities 'modules/identities.bicep' = {
  scope: group
  name: 'identities'
  params: {
    prefix: prefix
    location: location
    moneyService: moneyService
    tags: allTags
  }
}

module network 'modules/network.bicep' = {
  scope: group
  name: 'network'
  params: {
    prefix: prefix
    location: location
    addressSpace: addressSpace
    egressFirewall: egressFirewall
    // New Azure subnets get no default internet access, so even the lean profile keeps its NAT gateway.
    publicCore: lean
    tags: allTags
  }
}

var hostsFromUrl = empty(chain.?rpcUrl ?? '') ? [] : [split(split(chain.rpcUrl, '://')[1], '/')[0]]

module firewall 'modules/firewall.bicep' = if (egressFirewall) {
  scope: group
  name: 'firewall'
  params: {
    prefix: prefix
    location: location
    subnetId: network.outputs.subnetIds.firewall
    sources: {
      core: network.outputs.prefixes.core
      money: network.outputs.prefixes.money
    }
    // Email and SMS providers, and the deal record's JSON-RPC endpoint.
    coreDestinations: concat(['api.resend.com', 'api.twilio.com'], hostsFromUrl)
    moneyDestinations: plaid.env == 'production' ? ['production.plaid.com'] : plaid.env == 'sandbox' ? ['sandbox.plaid.com'] : []
    workspaceId: monitoring.outputs.id
    tags: allTags
  }
}

var zoneNames = [
  'privatelink.vaultcore.azure.net'
  'privatelink.postgres.database.azure.com'
  'privatelink.blob.${environment().suffixes.storage}'
  'privatelink.azurecr.io'
]

module dns 'modules/private-dns.bicep' = {
  scope: group
  name: 'private-dns'
  params: {
    zones: zoneNames
    vnetId: network.outputs.vnetId
    tags: allTags
  }
}

module coreVault 'modules/keyvault.bicep' = {
  scope: group
  name: 'kv-core'
  params: {
    name: take('kv-${environmentName}-core-${unique}', 24)
    location: location
    keys: [
      // Wraps the web app's data keys (bank tokens, account numbers in the app database).
      { name: 'data-kek', kty: 'RSA-HSM', keySize: 3072, keyOps: ['wrapKey', 'unwrapKey'] }
      // The deal record's recording account: secp256k1, signs in the HSM.
      { name: 'chain-recorder', kty: 'EC-HSM', curveName: 'P-256K', keyOps: ['sign', 'verify'] }
      // Blob Storage's customer-managed key.
      { name: 'storage-cmk', kty: 'RSA-HSM', keySize: 3072, keyOps: ['wrapKey', 'unwrapKey'] }
    ]
    workspaceId: monitoring.outputs.id
    subnetId: network.outputs.subnetIds.peCore
    dnsZoneId: dns.outputs.ids['privatelink.vaultcore.azure.net']
    lock: production
    tags: allTags
  }
}

module moneyVault 'modules/keyvault.bicep' = if (moneyService) {
  scope: group
  name: 'kv-money'
  params: {
    name: take('kv-${environmentName}-money-${unique}', 24)
    location: location
    keys: [
      // Wraps every data key in the money service (bank tokens, account numbers).
      { name: 'money-kek', kty: 'RSA-HSM', keySize: 3072, keyOps: ['wrapKey', 'unwrapKey'] }
    ]
    workspaceId: monitoring.outputs.id
    subnetId: network.outputs.subnetIds.peMoney
    dnsZoneId: dns.outputs.ids['privatelink.vaultcore.azure.net']
    lock: production
    tags: allTags
  }
}

module registry 'modules/registry.bicep' = {
  scope: group
  name: 'registry'
  params: {
    name: 'cr${replace(prefix, '-', '')}${unique}'
    location: location
    zoneRedundant: production
    sku: lean ? 'Basic' : 'Premium'
    workspaceId: monitoring.outputs.id
    subnetId: network.outputs.subnetIds.peShared
    dnsZoneId: dns.outputs.ids['privatelink.azurecr.io']
    pusherPrincipalId: deployerPrincipalId
    tags: allTags
  }
}

module corePostgres 'modules/postgres.bicep' = {
  scope: group
  name: 'postgres-core'
  params: {
    name: 'psql-${prefix}-core-${unique}'
    location: location
    databaseName: 'close'
    sku: postgres.sku
    storageSizeGB: postgres.storageSizeGB
    highAvailability: postgres.highAvailability
    geoRedundantBackup: postgres.geoRedundantBackup
    backupRetentionDays: postgres.backupRetentionDays
    extensions: 'PGCRYPTO'
    administrator: {
      principalId: identities.outputs.migrate.principalId
      name: identities.outputs.migrate.name
    }
    workspaceId: monitoring.outputs.id
    subnetId: network.outputs.subnetIds.peCore
    dnsZoneId: dns.outputs.ids['privatelink.postgres.database.azure.com']
    lock: production
    tags: allTags
  }
}

module moneyPostgres 'modules/postgres.bicep' = if (moneyService) {
  scope: group
  name: 'postgres-money'
  params: {
    name: 'psql-${prefix}-money-${unique}'
    location: location
    databaseName: 'money'
    sku: postgres.sku
    storageSizeGB: postgres.storageSizeGB
    highAvailability: postgres.highAvailability
    geoRedundantBackup: postgres.geoRedundantBackup
    backupRetentionDays: postgres.backupRetentionDays
    extensions: ''
    administrator: {
      principalId: identities.outputs.moneyMigrate.?principalId ?? ''
      name: identities.outputs.moneyMigrate.?name ?? ''
    }
    workspaceId: monitoring.outputs.id
    subnetId: network.outputs.subnetIds.peMoney
    dnsZoneId: dns.outputs.ids['privatelink.postgres.database.azure.com']
    lock: production
    tags: allTags
  }
}

module storageKeyAccess 'modules/rbac-storage-key.bicep' = {
  scope: group
  name: 'rbac-storage-key'
  params: {
    vaultName: coreVault.outputs.name
    principalId: identities.outputs.storage.principalId
  }
}

module storage 'modules/storage.bicep' = {
  scope: group
  name: 'storage'
  dependsOn: [storageKeyAccess]
  params: {
    name: take('st${replace(prefix, '-', '')}${unique}', 24)
    location: location
    skuName: production ? 'Standard_GZRS' : 'Standard_ZRS'
    identityId: identities.outputs.storage.id
    keyVaultUri: coreVault.outputs.uri
    keyName: 'storage-cmk'
    workspaceId: monitoring.outputs.id
    subnetId: network.outputs.subnetIds.peCore
    dnsZoneId: dns.outputs.ids['privatelink.blob.${environment().suffixes.storage}']
    retentionDays: 35
    lock: production
    tags: allTags
  }
}

module access 'modules/rbac.bicep' = {
  scope: group
  name: 'rbac'
  params: {
    coreVaultName: coreVault.outputs.name
    moneyVaultName: moneyService ? moneyVault!.outputs.name : ''
    storageName: storage.outputs.name
    registryName: registry.outputs.name
    principals: union(
      {
        web: identities.outputs.web.principalId
        worker: identities.outputs.worker.principalId
        migrate: identities.outputs.migrate.principalId
      },
      moneyService
        ? {
            money: identities.outputs.money.principalId
            moneyMigrate: identities.outputs.moneyMigrate.principalId
          }
        : {}
    )
    demoData: demoMode
  }
}

var workloadProfiles = [
  {
    name: 'Consumption'
    workloadProfileType: 'Consumption'
  }
]

module coreEnvironment 'modules/container-environment.bicep' = {
  scope: group
  name: 'cae-core'
  params: {
    name: 'cae-${prefix}-core'
    location: location
    internal: !lean
    subnetId: network.outputs.subnetIds.core
    zoneRedundant: production
    workloadProfiles: workloadProfiles
    workspaceId: monitoring.outputs.id
    tags: allTags
  }
}

module moneyEnvironment 'modules/container-environment.bicep' = if (moneyService) {
  scope: group
  name: 'cae-money'
  params: {
    name: 'cae-${prefix}-money'
    location: location
    subnetId: network.outputs.subnetIds.money
    zoneRedundant: production
    workloadProfiles: workloadProfiles
    workspaceId: monitoring.outputs.id
    tags: allTags
  }
}

module moneyDns 'modules/environment-dns.bicep' = if (moneyService) {
  scope: group
  name: 'cae-money-dns'
  params: {
    defaultDomain: moneyEnvironment!.outputs.defaultDomain
    staticIp: moneyEnvironment!.outputs.staticIp
    vnetId: network.outputs.vnetId
    tags: allTags
  }
}

var appHost = lean
  ? 'web.${coreEnvironment.outputs.defaultDomain}'
  : empty(appHostName) ? frontDoorBase!.outputs.endpointHostName : appHostName
var appUrl = 'https://${appHost}'

// The edge exists from phase 1, so the endpoint's host name is known before the apps.
module frontDoorBase 'modules/frontdoor.bicep' = if (!lean) {
  scope: group
  name: 'frontdoor-base'
  params: {
    prefix: prefix
    location: location
    hostName: appHostName
    wafMode: wafMode
    web: {}
    hooks: {}
    workspaceId: monitoring.outputs.id
    tags: allTags
  }
}

module ceremony 'modules/ceremony.bicep' = if (withCeremony) {
  scope: group
  name: 'ceremony'
  dependsOn: [access]
  params: {
    location: location
    environmentId: coreEnvironment.outputs.id
    registryServer: registry.outputs.loginServer
    image: images.worker
    identity: identities.outputs.worker
    vaultUri: coreVault.outputs.uri
    tags: allTags
  }
}

module coreApps 'modules/core-apps.bicep' = if (withApps) {
  scope: group
  name: 'core-apps'
  dependsOn: [access]
  params: {
    location: location
    environmentId: coreEnvironment.outputs.id
    registryServer: registry.outputs.loginServer
    images: images
    identities: {
      web: identities.outputs.web
      worker: identities.outputs.worker
      migrate: identities.outputs.migrate
    }
    appUrl: appUrl
    appEnv: appEnv
    demoMode: demoMode
    database: {
      fqdn: corePostgres.outputs.fqdn
      name: 'close'
    }
    blobUrl: storage.outputs.blobUrl
    vaultUri: coreVault.outputs.uri
    money: moneyService ? { url: 'https://money.${moneyEnvironment!.outputs.defaultDomain}:8443' } : {}
    chain: chain
    webScale: web
    allowedClientIps: lean ? allowedClientIps : []
    tags: allTags
  }
}

module moneyApps 'modules/money-apps.bicep' = if (withApps && moneyService) {
  scope: group
  name: 'money-apps'
  dependsOn: [access, moneyDns]
  params: {
    location: location
    environmentId: moneyEnvironment!.outputs.id
    registryServer: registry.outputs.loginServer
    image: images.money
    identities: {
      money: identities.outputs.money
      moneyMigrate: identities.outputs.moneyMigrate
    }
    appUrl: appUrl
    moneyEnv: appEnv
    database: {
      fqdn: moneyPostgres!.outputs.fqdn
      name: 'money'
    }
    vaultUri: moneyVault!.outputs.uri
    plaid: plaid
    minReplicas: production ? 2 : 1
    tags: allTags
  }
}

module frontDoor 'modules/frontdoor.bicep' = if (withApps && !lean) {
  scope: group
  name: 'frontdoor'
  params: {
    prefix: prefix
    location: location
    hostName: appHostName
    wafMode: wafMode
    web: {
      fqdn: coreApps!.outputs.webFqdn
      environmentId: coreEnvironment.outputs.id
    }
    hooks: moneyService && plaid.env != 'off'
      ? {
          fqdn: moneyApps!.outputs.hooksFqdn
          environmentId: moneyEnvironment!.outputs.id
        }
      : {}
    workspaceId: monitoring.outputs.id
    tags: allTags
  }
}

module defender 'modules/defender.bicep' = if (enableDefender) {
  name: 'defender-${environmentName}'
}

module activityLog 'modules/activity-log.bicep' = {
  name: 'activity-log-${environmentName}'
  params: {
    name: 'activity-to-${prefix}'
    workspaceId: monitoring.outputs.id
  }
}

module governance 'modules/governance.bicep' = {
  scope: group
  name: 'governance'
  params: {
    location: location
    budget: union(budget, { startDate: budgetStartDate })
  }
}

output resourceGroup string = group.name
output registry string = registry.outputs.loginServer
output costProfile string = costProfile
output registryRestricted bool = registry.outputs.restricted
output frontDoorHost string = lean ? '' : frontDoorBase!.outputs.endpointHostName
output appHost string = appHost
output privateLinkRequestMessage string = lean ? '' : frontDoorBase!.outputs.privateLinkRequestMessage
output coreEnvironmentId string = coreEnvironment.outputs.id
output moneyEnvironmentId string = moneyService ? moneyEnvironment!.outputs.id : ''
output customDomainValidationToken string = lean ? '' : frontDoorBase!.outputs.domainValidationToken
output coreEnvironment string = coreEnvironment.outputs.name
output moneyEnvironment string = moneyService ? moneyEnvironment!.outputs.name : ''
output moneyHost string = moneyService ? 'money.${moneyEnvironment!.outputs.defaultDomain}' : ''
output coreVault string = coreVault.outputs.name
output moneyVault string = moneyService ? moneyVault!.outputs.name : ''
output storageAccount string = storage.outputs.name
output egressIp string = egressFirewall ? firewall!.outputs.egressIp : network.outputs.egressIp
output migrateJob string = withApps ? coreApps!.outputs.migrateJob : ''
output moneyMigrateJob string = withApps && moneyService ? moneyApps!.outputs.migrateJob : ''
output keysJob string = withCeremony ? ceremony!.outputs.job : ''
