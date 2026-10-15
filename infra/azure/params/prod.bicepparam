// Production: zone-redundant everything, Azure Firewall egress, the isolated
// money service, geo-redundant database backups kept 35 days.
//
// The platform (phase 1) can be deployed now. The apps (phase 2) wait for
// real sign-in on Microsoft Entra and contracted identity, signature, payment
// and escrow providers: the app refuses to start in production without them.
using '../main.bicep'

param environmentName = 'prod'
param location = 'eastus2'
param appHostName = 'close.sagolik.com'
param demoMode = false
param moneyService = true
param egressFirewall = true
param wafMode = 'Prevention'
param postgres = {
  sku: {
    name: 'Standard_D4ds_v5'
    tier: 'GeneralPurpose'
  }
  storageSizeGB: 128
  highAvailability: true
  geoRedundantBackup: true
  backupRetentionDays: 35
}
param web = {
  min: 2
  max: 10
}
// Turned on once the registry is deployed on Base and the recording account is funded.
param chain = {
  network: 'off'
  rpcUrl: ''
  registry: ''
}
// Turned on with Plaid production access.
param plaid = {
  env: 'off'
  clientId: ''
}
param logRetentionDays = 90

// Set by the deploy pipeline.
param phase = readEnvironmentVariable('DEPLOY_PHASE', 'platform')
param deployerPrincipalId = readEnvironmentVariable('DEPLOYER_PRINCIPAL_ID', '')
param images = {
  web: readEnvironmentVariable('WEB_IMAGE', '')
  worker: readEnvironmentVariable('WORKER_IMAGE', '')
  money: readEnvironmentVariable('MONEY_IMAGE', '')
}

param budget = {
  amount: 5000
  contactEmails: []
}
