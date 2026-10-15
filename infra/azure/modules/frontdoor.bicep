// Azure Front Door Premium: the platform's only public endpoint. The WAF
// (Microsoft's default rule set, bot protection and rate limits) inspects
// every request; origins are the internal Container Apps environments over
// Private Link, so the apps have no public address at all. Nothing is cached.
// Each Private Link connection must be approved on its environment once
// (the deploy pipeline does it).

param prefix string
param location string // where the Private Link connections land
param hostName string // custom domain, or empty for the endpoint's own name
param wafMode string // Detection | Prevention
param web object // { fqdn, environmentId } or {} before the apps exist
param hooks object // { fqdn, environmentId } or {} without Plaid webhooks
param workspaceId string
param tags object

var routed = !empty(web)
// The deploy pipeline approves only Private Link requests carrying this message; the token
// derives from the profile's id, which isn't public, so a stranger can't forge a matching request.
var requestMessage = 'Front Door ${prefix} ${uniqueString(profile.id)}'

resource profile 'Microsoft.Cdn/profiles@2024-09-01' = {
  name: 'afd-${prefix}'
  location: 'global'
  tags: tags
  sku: {
    name: 'Premium_AzureFrontDoor'
  }
  properties: {
    originResponseTimeoutSeconds: 60
  }
}

resource waf 'Microsoft.Network/FrontDoorWebApplicationFirewallPolicies@2024-02-01' = {
  name: replace('waf${prefix}', '-', '')
  location: 'global'
  tags: tags
  sku: {
    name: 'Premium_AzureFrontDoor'
  }
  properties: {
    policySettings: {
      enabledState: 'Enabled'
      mode: wafMode
      requestBodyCheck: 'Enabled'
    }
    managedRules: {
      managedRuleSets: [
        {
          ruleSetType: 'Microsoft_DefaultRuleSet'
          ruleSetVersion: '2.1'
          ruleSetAction: 'Block'
        }
        {
          ruleSetType: 'Microsoft_BotManagerRuleSet'
          ruleSetVersion: '1.1'
        }
      ]
    }
    customRules: {
      rules: [
        {
          // Credential stuffing: sign-in attempts per client address.
          name: 'SignInRateLimit'
          priority: 10
          enabledState: 'Enabled'
          ruleType: 'RateLimitRule'
          rateLimitDurationInMinutes: 1
          rateLimitThreshold: 30
          action: 'Block'
          matchConditions: [
            {
              matchVariable: 'RequestUri'
              operator: 'Contains'
              matchValue: ['/sign-in']
              transforms: ['Lowercase']
            }
            {
              matchVariable: 'RequestMethod'
              operator: 'Equal'
              matchValue: ['POST']
            }
          ]
        }
        {
          name: 'ApiRateLimit'
          priority: 20
          enabledState: 'Enabled'
          ruleType: 'RateLimitRule'
          rateLimitDurationInMinutes: 1
          rateLimitThreshold: 600
          action: 'Block'
          matchConditions: [
            {
              matchVariable: 'RequestUri'
              operator: 'Contains'
              matchValue: ['/api/']
              transforms: ['Lowercase']
            }
          ]
        }
      ]
    }
  }
}

resource endpoint 'Microsoft.Cdn/profiles/afdEndpoints@2024-09-01' = {
  parent: profile
  name: prefix
  location: 'global'
  tags: tags
  properties: {
    enabledState: 'Enabled'
  }
}

resource domain 'Microsoft.Cdn/profiles/customDomains@2024-09-01' = if (!empty(hostName)) {
  parent: profile
  name: replace(hostName, '.', '-')
  properties: {
    hostName: hostName
    tlsSettings: {
      certificateType: 'ManagedCertificate'
      minimumTlsVersion: 'TLS12'
    }
  }
}

resource webOrigins 'Microsoft.Cdn/profiles/originGroups@2024-09-01' = if (routed) {
  parent: profile
  name: 'web'
  properties: {
    // One origin: health probes would only add load (Microsoft's guidance for single-origin groups).
    loadBalancingSettings: {
      sampleSize: 4
      successfulSamplesRequired: 3
      additionalLatencyInMilliseconds: 50
    }
    sessionAffinityState: 'Disabled'
  }
}

resource webOrigin 'Microsoft.Cdn/profiles/originGroups/origins@2024-09-01' = if (routed) {
  parent: webOrigins
  name: 'web'
  properties: {
    hostName: web.?fqdn ?? ''
    originHostHeader: web.?fqdn ?? ''
    httpPort: 80
    httpsPort: 443
    priority: 1
    weight: 1000
    enabledState: 'Enabled'
    enforceCertificateNameCheck: true
    sharedPrivateLinkResource: {
      privateLink: {
        id: web.?environmentId ?? ''
      }
      groupId: 'managedEnvironments'
      privateLinkLocation: location
      requestMessage: requestMessage
    }
  }
}

resource hookOrigins 'Microsoft.Cdn/profiles/originGroups@2024-09-01' = if (routed && !empty(hooks)) {
  parent: profile
  name: 'money-hooks'
  properties: {
    loadBalancingSettings: {
      sampleSize: 4
      successfulSamplesRequired: 3
      additionalLatencyInMilliseconds: 50
    }
    sessionAffinityState: 'Disabled'
  }
}

resource hookOrigin 'Microsoft.Cdn/profiles/originGroups/origins@2024-09-01' = if (routed && !empty(hooks)) {
  parent: hookOrigins
  name: 'money-hooks'
  properties: {
    hostName: hooks.?fqdn ?? ''
    originHostHeader: hooks.?fqdn ?? ''
    httpPort: 80
    httpsPort: 443
    priority: 1
    weight: 1000
    enabledState: 'Enabled'
    enforceCertificateNameCheck: true
    sharedPrivateLinkResource: {
      privateLink: {
        id: hooks.?environmentId ?? ''
      }
      groupId: 'managedEnvironments'
      privateLinkLocation: location
      requestMessage: requestMessage
    }
  }
}

var domains = concat([{ id: endpoint.id }], empty(hostName) ? [] : [{ id: domain.id }])

resource webRoute 'Microsoft.Cdn/profiles/afdEndpoints/routes@2024-09-01' = if (routed) {
  parent: endpoint
  name: 'web'
  dependsOn: [webOrigin]
  properties: {
    customDomains: empty(hostName) ? [] : [{ id: domain.id }]
    originGroup: {
      id: webOrigins.id
    }
    supportedProtocols: ['Http', 'Https']
    patternsToMatch: ['/*']
    forwardingProtocol: 'HttpsOnly'
    httpsRedirect: 'Enabled'
    linkToDefaultDomain: 'Enabled'
    enabledState: 'Enabled'
  }
}

resource hookRoute 'Microsoft.Cdn/profiles/afdEndpoints/routes@2024-09-01' = if (routed && !empty(hooks)) {
  parent: endpoint
  name: 'money-hooks'
  dependsOn: [hookOrigin, webRoute]
  properties: {
    customDomains: empty(hostName) ? [] : [{ id: domain.id }]
    originGroup: {
      id: hookOrigins.id
    }
    supportedProtocols: ['Https']
    patternsToMatch: ['/webhooks/plaid']
    forwardingProtocol: 'HttpsOnly'
    httpsRedirect: 'Disabled'
    linkToDefaultDomain: 'Enabled'
    enabledState: 'Enabled'
  }
}

resource security 'Microsoft.Cdn/profiles/securityPolicies@2024-09-01' = {
  parent: profile
  name: 'waf'
  properties: {
    parameters: {
      type: 'WebApplicationFirewall'
      wafPolicy: {
        id: waf.id
      }
      associations: [
        {
          domains: domains
          patternsToMatch: ['/*']
        }
      ]
    }
  }
}

resource diagnostics 'Microsoft.Insights/diagnosticSettings@2021-05-01-preview' = {
  scope: profile
  name: 'to-log-analytics'
  properties: {
    workspaceId: workspaceId
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

output endpointHostName string = endpoint.properties.hostName
output privateLinkRequestMessage string = requestMessage
output profileId string = profile.id
// Front Door validates the custom domain with this TXT record at _dnsauth.<host>.
output domainValidationToken string = empty(hostName) ? '' : domain!.properties.validationProperties.validationToken
