// The core workloads: the web app, the worker and the migrate job. Each runs
// as its own managed identity: it pulls its image, reads its Key Vault
// secrets, signs in to PostgreSQL with Entra tokens and uses Blob Storage,
// all without a stored credential. The web app is reachable only through
// Front Door (Private Link); the worker has no ingress at all.

param location string
param environmentId string
param registryServer string
param images object // { web, worker }
param identities object // { web, worker, migrate }: { id, name, clientId, principalId }
param appUrl string
param appEnv string
param demoMode bool
param database object // { fqdn, name }
param blobUrl string
param vaultUri string
param money object // { url } or {} without the money service
param chain object // { network, rpcUrl, registry } ({} keeps the default)
param webScale object // { min, max }
param tags object

func secret(vaultUri string, name string, identityId string) object => {
  name: name
  keyVaultUrl: '${vaultUri}secrets/${name}'
  identity: identityId
}

func value(name string, v string) object => {
  name: name
  value: v
}

func ref(name string, secretName string) object => {
  name: name
  secretRef: secretName
}

var withMoney = !empty(money)
var liveChain = contains(['base', 'base-sepolia'], chain.?network ?? '')

// Settings every core workload shares; DATABASE_URL and the identity differ.
func shared(identity object, database object, appUrl string, appEnv string, demoMode bool, blobUrl string, chain object, liveChain bool) array =>
  concat(
    [
      value('APP_ENV', appEnv)
      value('APP_URL', appUrl)
      value('DATABASE_URL', 'postgres://${identity.name}@${database.fqdn}:5432/${database.name}?sslmode=verify-full')
      value('DATABASE_AUTH', 'entra')
      value('AZURE_CLIENT_ID', identity.clientId)
      value('AZURE_STORAGE_BLOB_URL', blobUrl)
      value('AZURE_STORAGE_CONTAINER', 'documents')
      ref('SESSION_SECRET', 'session-secret')
      ref('DATA_KEYS_WRAPPED', 'data-keys-wrapped')
      ref('DATA_KEK_ID', 'data-kek-id')
    ],
    demoMode ? [value('DEMO_MODE', 'true')] : [],
    liveChain
      ? [
          value('CHAIN_NETWORK', chain.network)
          value('CHAIN_RPC_URL', chain.rpcUrl)
          value('CHAIN_REGISTRY_ADDRESS', chain.registry)
          ref('CHAIN_DEAL_SALT', 'chain-deal-salt')
        ]
      : []
  )

func moneySettings(url string) array => [
  value('MONEY_SERVICE_URL', url)
  value('MONEY_SERVICE_CA_FILE', '/mnt/money/ca.pem')
  value('MONEY_SERVICE_CERT_FILE', '/mnt/money/client.pem')
  value('MONEY_SERVICE_KEY_FILE', '/mnt/money/client-key.pem')
  value('MONEY_ASSERTION_SIGNING_JWK_FILE', '/mnt/money/signing.jwk')
  value('MONEY_ASSERTION_KID', 'web-1')
]

func moneyVolume(client string) object => {
  name: 'money-tls'
  storageType: 'Secret'
  secrets: [
    { secretRef: 'money-ca', path: 'ca.pem' }
    { secretRef: '${client}-client-cert', path: 'client.pem' }
    { secretRef: '${client}-client-key', path: 'client-key.pem' }
    { secretRef: 'assertion-signing-jwk', path: 'signing.jwk' }
  ]
}

func coreSecrets(vaultUri string, identityId string, liveChain bool, withMoney bool, client string) array =>
  concat(
    [
      secret(vaultUri, 'session-secret', identityId)
      secret(vaultUri, 'data-keys-wrapped', identityId)
      secret(vaultUri, 'data-kek-id', identityId)
    ],
    liveChain ? [secret(vaultUri, 'chain-deal-salt', identityId)] : [],
    withMoney
      ? [
          secret(vaultUri, 'money-ca', identityId)
          secret(vaultUri, '${client}-client-cert', identityId)
          secret(vaultUri, '${client}-client-key', identityId)
          secret(vaultUri, 'assertion-signing-jwk', identityId)
        ]
      : []
  )

resource web 'Microsoft.App/containerApps@2025-07-01' = {
  name: 'web'
  location: location
  tags: tags
  identity: {
    type: 'UserAssigned'
    userAssignedIdentities: {
      '${identities.web.id}': {}
    }
  }
  properties: {
    environmentId: environmentId
    workloadProfileName: 'Consumption'
    configuration: {
      activeRevisionsMode: 'Single'
      ingress: {
        // "External" in an internal environment: reachable inside the network and through Front Door's Private Link.
        external: true
        targetPort: 3000
        transport: 'http'
        allowInsecure: false
      }
      registries: [
        {
          server: registryServer
          identity: identities.web.id
        }
      ]
      secrets: coreSecrets(vaultUri, identities.web.id, liveChain, withMoney, 'web')
    }
    template: {
      containers: [
        {
          name: 'web'
          image: images.web
          resources: {
            cpu: json('1.0')
            memory: '2Gi'
          }
          env: concat(
            shared(identities.web, database, appUrl, appEnv, demoMode, blobUrl, chain, liveChain),
            withMoney ? moneySettings(money.url) : []
          )
          volumeMounts: withMoney ? [{ volumeName: 'money-tls', mountPath: '/mnt/money' }] : []
          probes: [
            {
              type: 'Startup'
              httpGet: {
                path: '/api/health'
                port: 3000
              }
              periodSeconds: 5
              failureThreshold: 30
            }
            {
              // Readiness follows the database; liveness doesn't, so an outage there never restarts the app.
              type: 'Readiness'
              httpGet: {
                path: '/api/health'
                port: 3000
              }
              periodSeconds: 10
              failureThreshold: 3
            }
            {
              type: 'Liveness'
              tcpSocket: {
                port: 3000
              }
              periodSeconds: 30
              failureThreshold: 3
            }
          ]
        }
      ]
      volumes: withMoney ? [moneyVolume('web')] : []
      scale: {
        minReplicas: webScale.min
        maxReplicas: webScale.max
        rules: [
          {
            name: 'http'
            http: {
              metadata: {
                concurrentRequests: '50'
              }
            }
          }
        ]
      }
    }
  }
}

// Demo environments process events inside the web app (sandbox providers live there), so they have no worker.
resource worker 'Microsoft.App/containerApps@2025-07-01' = if (!demoMode) {
  name: 'worker'
  location: location
  tags: tags
  identity: {
    type: 'UserAssigned'
    userAssignedIdentities: {
      '${identities.worker.id}': {}
    }
  }
  properties: {
    environmentId: environmentId
    workloadProfileName: 'Consumption'
    configuration: {
      activeRevisionsMode: 'Single'
      registries: [
        {
          server: registryServer
          identity: identities.worker.id
        }
      ]
      secrets: concat(
        coreSecrets(vaultUri, identities.worker.id, liveChain, withMoney, 'worker'),
        liveChain ? [secret(vaultUri, 'chain-recorder-key-id', identities.worker.id)] : []
      )
    }
    template: {
      containers: [
        {
          name: 'worker'
          image: images.worker
          resources: {
            cpu: json('0.5')
            memory: '1Gi'
          }
          env: concat(
            shared(identities.worker, database, appUrl, appEnv, demoMode, blobUrl, chain, liveChain),
            liveChain ? [ref('CHAIN_RECORDER_KEY_ID', 'chain-recorder-key-id')] : [],
            withMoney ? moneySettings(money.url) : []
          )
          volumeMounts: withMoney ? [{ volumeName: 'money-tls', mountPath: '/mnt/money' }] : []
        }
      ]
      volumes: withMoney ? [moneyVolume('worker')] : []
      // One worker: deal-record entries go out one at a time, so nonces never race.
      scale: {
        minReplicas: 1
        maxReplicas: 1
      }
    }
  }
}

// Runs migrations as the database's Entra administrator, then lets the web
// and worker identities sign in and act as the API roles. Started by the
// deploy pipeline before each release.
resource migrate 'Microsoft.App/jobs@2025-07-01' = {
  name: 'migrate'
  location: location
  tags: tags
  identity: {
    type: 'UserAssigned'
    userAssignedIdentities: {
      '${identities.migrate.id}': {}
    }
  }
  properties: {
    environmentId: environmentId
    workloadProfileName: 'Consumption'
    configuration: {
      triggerType: 'Manual'
      replicaTimeout: 1800
      replicaRetryLimit: 0
      manualTriggerConfig: {
        parallelism: 1
        replicaCompletionCount: 1
      }
      registries: [
        {
          server: registryServer
          identity: identities.migrate.id
        }
      ]
      secrets: demoMode
        ? [
            secret(vaultUri, 'session-secret', identities.migrate.id)
            secret(vaultUri, 'data-keys-wrapped', identities.migrate.id)
            secret(vaultUri, 'data-kek-id', identities.migrate.id)
          ]
        : []
    }
    template: {
      containers: [
        {
          name: 'migrate'
          image: images.worker
          command: ['node', '--import', 'tsx', 'apps/worker/src/migrate.ts']
          args: concat(
            [
              '--grant'
              '${identities.web.name}=${identities.web.principalId}'
              '--grant'
              '${identities.worker.name}=${identities.worker.principalId}'
            ],
            demoMode ? ['--seed-demo'] : []
          )
          resources: {
            cpu: json('0.5')
            memory: '1Gi'
          }
          env: demoMode ? shared(identities.migrate, database, appUrl, appEnv, demoMode, blobUrl, chain, false) : [
            value('APP_ENV', appEnv)
            value('DATABASE_URL', 'postgres://${identities.migrate.name}@${database.fqdn}:5432/${database.name}?sslmode=verify-full')
            value('DATABASE_AUTH', 'entra')
            value('AZURE_CLIENT_ID', identities.migrate.clientId)
          ]
        }
      ]
    }
  }
}

output webFqdn string = web.properties.configuration.ingress.fqdn
output migrateJob string = migrate.name
