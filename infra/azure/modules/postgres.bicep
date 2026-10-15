// Azure Database for PostgreSQL Flexible Server 16: Entra authentication only
// (no passwords exist), TLS required, no public access (private endpoint),
// point-in-time restore, optional zone-redundant high availability and
// geo-redundant backups, and pgaudit for schema and role changes. The Entra
// administrator is the migration identity, which runs migrations and creates
// the workloads' database roles; workloads never administer the server.

param name string
param location string
param databaseName string
param sku object // { name, tier }
param storageSizeGB int
param highAvailability bool
param geoRedundantBackup bool
param backupRetentionDays int
param extensions string // azure.extensions allow-list, e.g. 'PGCRYPTO'; empty for none
param administrator object // { principalId, name }
param workspaceId string
param subnetId string
param dnsZoneId string
param lock bool
param tags object

resource server 'Microsoft.DBforPostgreSQL/flexibleServers@2024-08-01' = {
  name: name
  location: location
  tags: tags
  sku: {
    name: sku.name
    tier: sku.tier
  }
  properties: {
    version: '16'
    createMode: 'Default'
    authConfig: {
      activeDirectoryAuth: 'Enabled'
      passwordAuth: 'Disabled'
      tenantId: tenant().tenantId
    }
    storage: {
      storageSizeGB: storageSizeGB
      autoGrow: 'Enabled'
    }
    backup: {
      backupRetentionDays: backupRetentionDays
      geoRedundantBackup: geoRedundantBackup ? 'Enabled' : 'Disabled'
    }
    highAvailability: {
      mode: highAvailability ? 'ZoneRedundant' : 'Disabled'
    }
    network: {
      publicNetworkAccess: 'Disabled'
    }
  }
}

resource admin 'Microsoft.DBforPostgreSQL/flexibleServers/administrators@2024-08-01' = {
  parent: server
  name: administrator.principalId
  properties: {
    principalType: 'ServicePrincipal'
    principalName: administrator.name
    tenantId: tenant().tenantId
  }
}

resource database 'Microsoft.DBforPostgreSQL/flexibleServers/databases@2024-08-01' = {
  parent: server
  name: databaseName
  properties: {
    charset: 'UTF8'
    collation: 'en_US.utf8'
  }
}

// One at a time: the server refuses concurrent configuration changes.
// shared_preload_libraries takes effect after the first restart (runbook).
var settings = concat(empty(extensions) ? [] : [{ name: 'azure.extensions', value: extensions }], [
  { name: 'shared_preload_libraries', value: 'pg_stat_statements,pgaudit' }
  { name: 'pgaudit.log', value: 'ddl,role' }
  { name: 'pgaudit.log_parameter', value: 'off' }
  { name: 'log_connections', value: 'on' }
  { name: 'log_disconnections', value: 'on' }
  { name: 'require_secure_transport', value: 'on' }
  { name: 'ssl_min_protocol_version', value: 'TLSv1.2' }
])

@batchSize(1)
resource configuration 'Microsoft.DBforPostgreSQL/flexibleServers/configurations@2024-08-01' = [
  for s in settings: {
    parent: server
    name: s.name
    dependsOn: [admin, database]
    properties: {
      value: s.value
      source: 'user-override'
    }
  }
]

module endpoint 'private-endpoint.bicep' = {
  name: '${name}-pe'
  params: {
    name: 'pe-${name}'
    location: location
    subnetId: subnetId
    serviceId: server.id
    groupId: 'postgresqlServer'
    dnsZoneId: dnsZoneId
    tags: tags
  }
}

resource diagnostics 'Microsoft.Insights/diagnosticSettings@2021-05-01-preview' = {
  scope: server
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

resource deleteLock 'Microsoft.Authorization/locks@2020-05-01' = if (lock) {
  scope: server
  name: 'do-not-delete'
  properties: {
    level: 'CanNotDelete'
    notes: 'Production database.'
  }
}

output fqdn string = server.properties.fullyQualifiedDomainName
output name string = server.name
