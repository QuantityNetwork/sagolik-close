// Microsoft Defender for Cloud across the subscription: posture management,
// containers (image scanning), Key Vault, open-source databases, storage
// (with malware scanning of every upload) and Resource Manager.
targetScope = 'subscription'

param malwareScanCapGBPerMonth int = 5000

var plans = [
  { name: 'CloudPosture', subPlan: null, extensions: [] }
  { name: 'Containers', subPlan: null, extensions: [] }
  { name: 'KeyVaults', subPlan: 'PerKeyVault', extensions: [] }
  { name: 'OpenSourceRelationalDatabases', subPlan: null, extensions: [] }
  {
    name: 'StorageAccounts'
    subPlan: 'DefenderForStorageV2'
    extensions: [
      {
        name: 'OnUploadMalwareScanning'
        isEnabled: 'True'
        additionalExtensionProperties: {
          CapGBPerMonthPerStorageAccount: string(malwareScanCapGBPerMonth)
        }
      }
      {
        name: 'SensitiveDataDiscovery'
        isEnabled: 'True'
      }
    ]
  }
  { name: 'Arm', subPlan: 'PerSubscription', extensions: [] }
]

// One at a time: concurrent plan changes conflict.
@batchSize(1)
resource pricing 'Microsoft.Security/pricings@2024-01-01' = [
  for plan in plans: {
    name: plan.name
    properties: union(
      {
        pricingTier: 'Standard'
      },
      plan.subPlan == null ? {} : { subPlan: plan.subPlan },
      empty(plan.extensions) ? {} : { extensions: plan.extensions }
    )
  }
]
