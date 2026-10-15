// The money service in its own environment and subnet: the API (mutual TLS
// end to end, so the platform's ingress only passes TCP through), the Plaid
// webhook listener behind Front Door, and its migrate job. It signs in to its
// own database and its own Key Vault with its own identity; the web app has
// no access to either.

param location string
param environmentId string
param registryServer string
param image string
param identities object // { money, moneyMigrate }
param appUrl string
param moneyEnv string // staging | production
param database object // { fqdn, name }
param vaultUri string
param plaid object // { env: off | sandbox | production, clientId }
param minReplicas int
param tags object

var plaidOn = plaid.env != 'off'

func secret(vaultUri string, name string, identityId string) object => {
  name: name
  keyVaultUrl: '${vaultUri}secrets/${name}'
  identity: identityId
}

func value(name string, v string) object => {
  name: name
  value: v
}

var secrets = concat(
  [
    secret(vaultUri, 'money-server-cert', identities.money.id)
    secret(vaultUri, 'money-server-key', identities.money.id)
    secret(vaultUri, 'money-ca', identities.money.id)
    secret(vaultUri, 'money-assertion-jwks', identities.money.id)
  ],
  plaidOn ? [secret(vaultUri, 'plaid-secret', identities.money.id)] : []
)

var files = {
  name: 'tls'
  storageType: 'Secret'
  secrets: concat(
    [
      { secretRef: 'money-server-cert', path: 'server.pem' }
      { secretRef: 'money-server-key', path: 'server-key.pem' }
      { secretRef: 'money-ca', path: 'ca.pem' }
      { secretRef: 'money-assertion-jwks', path: 'jwks.json' }
    ],
    plaidOn ? [{ secretRef: 'plaid-secret', path: 'plaid-secret' }] : []
  )
}

var settings = concat(
  [
    value('MONEY_ENV', moneyEnv)
    value('MONEY_LISTEN_ADDR', ':8443')
    value('MONEY_HEALTH_ADDR', ':8081')
    value('MONEY_DATABASE_URL', 'postgres://${identities.money.name}@${database.fqdn}:5432/${database.name}?sslmode=verify-full')
    value('MONEY_DATABASE_AUTH', 'entra')
    value('AZURE_CLIENT_ID', identities.money.clientId)
    value('MONEY_KEY_PROVIDER', 'azurekv')
    value('MONEY_AZURE_KEY_ID', '${vaultUri}keys/money-kek')
    value('MONEY_TLS_CERT_FILE', '/mnt/tls/server.pem')
    value('MONEY_TLS_KEY_FILE', '/mnt/tls/server-key.pem')
    value('MONEY_TLS_CLIENT_CA_FILE', '/mnt/tls/ca.pem')
    value('MONEY_TLS_ALLOWED_CLIENTS', 'spiffe://sagolik/web,spiffe://sagolik/worker')
    value('MONEY_ASSERTION_JWKS_FILE', '/mnt/tls/jwks.json')
    value('MONEY_PLAID_ENV', plaid.env)
  ],
  plaidOn
    ? [
        value('MONEY_PLAID_CLIENT_ID', plaid.clientId)
        value('MONEY_PLAID_SECRET_FILE', '/mnt/tls/plaid-secret')
        value('MONEY_PLAID_REDIRECT_URI', '${appUrl}/api/v1/bank-connections/callback')
        value('MONEY_PLAID_WEBHOOK_URL', '${appUrl}/webhooks/plaid')
      ]
    : []
)

var probes = [
  {
    type: 'Readiness'
    httpGet: {
      path: '/readyz'
      port: 8081
    }
    periodSeconds: 10
    failureThreshold: 3
  }
  {
    type: 'Liveness'
    httpGet: {
      path: '/healthz'
      port: 8081
    }
    periodSeconds: 30
    failureThreshold: 3
  }
]

resource api 'Microsoft.App/containerApps@2025-07-01' = {
  name: 'money'
  location: location
  tags: tags
  identity: {
    type: 'UserAssigned'
    userAssignedIdentities: {
      '${identities.money.id}': {}
    }
  }
  properties: {
    environmentId: environmentId
    workloadProfileName: 'Consumption'
    configuration: {
      activeRevisionsMode: 'Single'
      ingress: {
        // TCP passthrough: the service terminates TLS itself and checks the caller's client certificate.
        external: true
        transport: 'tcp'
        targetPort: 8443
        exposedPort: 8443
      }
      registries: [
        {
          server: registryServer
          identity: identities.money.id
        }
      ]
      secrets: secrets
    }
    template: {
      containers: [
        {
          name: 'money'
          image: image
          resources: {
            cpu: json('0.5')
            memory: '1Gi'
          }
          env: settings
          volumeMounts: [
            {
              volumeName: 'tls'
              mountPath: '/mnt/tls'
            }
          ]
          probes: probes
        }
      ]
      volumes: [files]
      scale: {
        minReplicas: minReplicas
        maxReplicas: max(minReplicas, 4)
      }
    }
  }
}

// Plaid's webhooks: the same image with only the webhook listener exposed, behind Front Door's WAF.
resource hooks 'Microsoft.App/containerApps@2025-07-01' = if (plaidOn) {
  name: 'money-hooks'
  location: location
  tags: tags
  identity: {
    type: 'UserAssigned'
    userAssignedIdentities: {
      '${identities.money.id}': {}
    }
  }
  properties: {
    environmentId: environmentId
    workloadProfileName: 'Consumption'
    configuration: {
      activeRevisionsMode: 'Single'
      ingress: {
        external: true
        transport: 'http'
        targetPort: 8090
        allowInsecure: false
      }
      registries: [
        {
          server: registryServer
          identity: identities.money.id
        }
      ]
      secrets: secrets
    }
    template: {
      containers: [
        {
          name: 'money-hooks'
          image: image
          resources: {
            cpu: json('0.25')
            memory: '0.5Gi'
          }
          env: concat(settings, [value('MONEY_WEBHOOK_ADDR', ':8090')])
          volumeMounts: [
            {
              volumeName: 'tls'
              mountPath: '/mnt/tls'
            }
          ]
          probes: probes
        }
      ]
      volumes: [files]
      scale: {
        minReplicas: 1
        maxReplicas: 2
      }
    }
  }
}

resource migrate 'Microsoft.App/jobs@2025-07-01' = {
  name: 'money-migrate'
  location: location
  tags: tags
  identity: {
    type: 'UserAssigned'
    userAssignedIdentities: {
      '${identities.moneyMigrate.id}': {}
    }
  }
  properties: {
    environmentId: environmentId
    workloadProfileName: 'Consumption'
    configuration: {
      triggerType: 'Manual'
      replicaTimeout: 900
      replicaRetryLimit: 0
      manualTriggerConfig: {
        parallelism: 1
        replicaCompletionCount: 1
      }
      registries: [
        {
          server: registryServer
          identity: identities.moneyMigrate.id
        }
      ]
    }
    template: {
      containers: [
        {
          name: 'money-migrate'
          image: image
          args: ['migrate', '--grant', '${identities.money.name}=${identities.money.principalId}']
          resources: {
            cpu: json('0.25')
            memory: '0.5Gi'
          }
          env: [
            value('MONEY_ENV', moneyEnv)
            value('MONEY_DATABASE_URL', 'postgres://${identities.moneyMigrate.name}@${database.fqdn}:5432/${database.name}?sslmode=verify-full')
            value('MONEY_DATABASE_AUTH', 'entra')
            value('AZURE_CLIENT_ID', identities.moneyMigrate.clientId)
          ]
        }
      ]
    }
  }
}

output hooksFqdn string = plaidOn ? hooks!.properties.configuration.ingress.fqdn : ''
output migrateJob string = migrate.name
