// Development: the fictional demo on the real platform (PostgreSQL with RLS,
// Blob Storage, Key Vault HSM keys, managed identities, logs), with sandbox
// providers, in the lean profile (about $100-150 a month): no Front Door (the
// web app has its own public address, optionally limited to DEV_ALLOWED_IPS),
// a Basic registry, no Defender or Sentinel, no money service (the demo keeps
// payment instructions in the app, encrypted with its own wrapped data keys).
using '../main.bicep'

param environmentName = 'dev'
param location = 'eastus2'
param demoMode = true
param moneyService = false
param egressFirewall = false
param costProfile = 'lean'
// Comma-separated CIDRs, e.g. "203.0.113.7/32,198.51.100.0/24"; empty lets anyone in (fictional data only).
param allowedClientIps = empty(readEnvironmentVariable('DEV_ALLOWED_IPS', '')) ? [] : split(readEnvironmentVariable('DEV_ALLOWED_IPS', ''), ',')
// Subscription-wide security plans and the SIEM run with production.
param enableDefender = false
param enableSentinel = false
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
  amount: 200
  contactEmails: []
}
