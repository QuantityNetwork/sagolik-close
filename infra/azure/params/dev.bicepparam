// Development: the fictional demo on the real platform (PostgreSQL with RLS,
// Blob Storage, Key Vault, Front Door), with sandbox providers. Small SKUs,
// a NAT gateway instead of Azure Firewall, and no money service (the demo
// keeps payment instructions in the app, encrypted with its own data keys).
using '../main.bicep'

param environmentName = 'dev'
param location = 'eastus2'
param demoMode = true
param moneyService = false
param egressFirewall = false
// Learn the WAF's false positives on real traffic first; production blocks.
param wafMode = 'Detection'
param logRetentionDays = 30

// Set by the deploy pipeline.
param phase = readEnvironmentVariable('DEPLOY_PHASE', 'platform')
param deployerPrincipalId = readEnvironmentVariable('DEPLOYER_PRINCIPAL_ID', '')
param images = {
  web: readEnvironmentVariable('WEB_IMAGE', '')
  worker: readEnvironmentVariable('WORKER_IMAGE', '')
  money: readEnvironmentVariable('MONEY_IMAGE', '')
}

param budget = {
  amount: 800
  contactEmails: []
}
