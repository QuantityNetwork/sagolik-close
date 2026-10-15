// The key ceremony job. Key Vault has no public access, so the operations
// that need its data plane run inside the network, as the worker's identity:
// wrap a new random data key with data-kek (it never exists outside this job's
// memory) and read the recording key's public half. The output is public
// material only: the wrapped key, the exact key versions and an address.
//
//   az containerapp job start -n keys -g <resource group>
// Then read the execution's log (docs/azure/runbook.md).

param location string
param environmentId string
param registryServer string
param image string
param identity object // the worker's: { id, clientId }
param vaultUri string
param tags object

resource keys 'Microsoft.App/jobs@2025-07-01' = {
  name: 'keys'
  location: location
  tags: tags
  identity: {
    type: 'UserAssigned'
    userAssignedIdentities: {
      '${identity.id}': {}
    }
  }
  properties: {
    environmentId: environmentId
    workloadProfileName: 'Consumption'
    configuration: {
      triggerType: 'Manual'
      replicaTimeout: 300
      replicaRetryLimit: 0
      manualTriggerConfig: {
        parallelism: 1
        replicaCompletionCount: 1
      }
      registries: [
        {
          server: registryServer
          identity: identity.id
        }
      ]
    }
    template: {
      containers: [
        {
          name: 'keys'
          image: image
          command: ['node', '--import', 'tsx', 'apps/worker/src/keys.ts']
          args: ['ceremony', 'v1', '${vaultUri}keys/data-kek', '${vaultUri}keys/chain-recorder']
          resources: {
            cpu: json('0.25')
            memory: '0.5Gi'
          }
          env: [
            {
              name: 'AZURE_CLIENT_ID'
              value: identity.clientId
            }
          ]
        }
      ]
    }
  }
}

output job string = keys.name
