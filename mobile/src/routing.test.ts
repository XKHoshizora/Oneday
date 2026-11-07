import { load } from 'js-yaml'
import { describe, expect, it } from 'vitest'

import { normalizeProfile, parseNodes, runtimeConfig } from './profile'
import {
  type CustomRule,
  normalizeRouting,
  parseRuleValue,
  ruleLines,
} from './routing'

const nodes = parseNodes(`proxies:
  - {name: Hy2, type: hysteria2, server: example.net, port: 8443, password: fixture-password}
`)

type Runtime = {
  dns: Record<string, unknown>
  'rule-providers'?: Record<string, { path: string; format: string }>
  rules: string[]
}

function runtime(rules: CustomRule[], chinaLists = true) {
  return load(runtimeConfig(nodes, 'Hy2', { rules, chinaLists })) as Runtime
}

function rule(
  kind: CustomRule['kind'],
  value: string,
  action: CustomRule['action'],
  enabled = true,
): CustomRule {
  return { id: `${kind}-${value}`, kind, value, action, enabled }
}

describe('split routing', () => {
  it('sends the China lists direct, keeps local networks direct and proxies everything else', () => {
    const config = runtime([])
    // UDP the node cannot carry is refused rather than sent direct.
    expect(config).toHaveProperty('x-clash-udp-unsupported', 'REJECT')
    expect(config.rules.slice(-3)).toEqual([
      'RULE-SET,cn-domain,DIRECT',
      'RULE-SET,cn-ip,DIRECT',
      'MATCH,Oneday',
    ])
    for (const range of [
      'IP-CIDR,192.168.0.0/16,DIRECT',
      'IP-CIDR,10.0.0.0/8,DIRECT',
      'IP-CIDR6,fc00::/7,DIRECT',
      'IP-CIDR6,fe80::/10,DIRECT',
    ])
      expect(config.rules).toContain(range)
    expect(config['rule-providers']).toMatchObject({
      'cn-domain': { format: 'mrs', path: 'routing/cn-domain.mrs' },
      'cn-ip': { format: 'mrs', path: 'routing/cn-ip.mrs' },
    })
    // China names resolve at home; other lookups ride the node; node servers never wait on the tunnel.
    expect(config.dns['nameserver-policy']).toEqual({
      'rule-set:cn-domain': [
        'https://223.5.5.5/dns-query',
        'https://1.12.12.12/dns-query',
      ],
    })
    expect(config.dns.nameserver).toEqual([
      'https://1.1.1.1/dns-query#Oneday',
      'https://8.8.8.8/dns-query#Oneday',
    ])
    expect(String(config.dns['proxy-server-nameserver'])).not.toContain('#')
    expect(String(config.dns['direct-nameserver'])).not.toContain('#')
  })

  it('puts enabled exceptions first, most specific first, ahead of the defaults', () => {
    const config = runtime([
      rule('ip', '10.0.0.0/8', 'proxy'),
      rule('suffix', 'example.com', 'proxy'),
      rule('suffix', 'cn', 'proxy'),
      rule('ip', '10.1.0.0/16', 'direct'),
      rule('domain', 'www.example.com', 'direct'),
      rule('suffix', 'a.example.com', 'direct'),
      rule('ip', '2001:db8::/32', 'proxy'),
      rule('suffix', 'disabled.example', 'direct', false),
    ])
    expect(config.rules.slice(0, 8)).toEqual([
      'DOMAIN,www.example.com,DIRECT',
      'DOMAIN-SUFFIX,a.example.com,DIRECT',
      'DOMAIN-SUFFIX,example.com,Oneday',
      'DOMAIN-SUFFIX,cn,Oneday',
      'IP-CIDR6,2001:db8::/32,Oneday',
      'IP-CIDR,10.1.0.0/16,DIRECT',
      'IP-CIDR,10.0.0.0/8,Oneday',
      'IP-CIDR,10.0.0.0/8,DIRECT',
    ])
    expect(config.rules.join('\n')).not.toContain('disabled.example')
  })

  it('falls back to the node, never to direct, when the China lists are unavailable', () => {
    const config = runtime([rule('suffix', 'example.cn', 'direct')], false)
    expect(config).not.toHaveProperty('rule-providers')
    expect(config.dns).not.toHaveProperty('nameserver-policy')
    expect(config.rules[0]).toBe('DOMAIN-SUFFIX,example.cn,DIRECT')
    expect(config.rules.at(-1)).toBe('MATCH,Oneday')
    expect(config.rules.join('\n')).not.toContain('RULE-SET')
  })
})

describe('exception values', () => {
  it('normalizes domains and matches suffixes only on label boundaries', () => {
    expect(parseRuleValue('suffix', ' *.Example.COM. ')).toBe('example.com')
    expect(parseRuleValue('suffix', '.example.com')).toBe('example.com')
    expect(parseRuleValue('domain', 'https://WWW.example.com/path?q')).toBe(
      'www.example.com',
    )
    expect(parseRuleValue('suffix', '例子.中国')).toBe('xn--fsqu00a.xn--fiqs8s')
    // DOMAIN-SUFFIX matches the name and its subdomains only; nothing becomes a keyword or pattern.
    expect(
      ruleLines([rule('suffix', 'example.com', 'direct')], 'Oneday'),
    ).toEqual(['DOMAIN-SUFFIX,example.com,DIRECT'])
    for (const [kind, input] of [
      ['domain', '*.example.com'],
      ['suffix', 'exa mple.com'],
      ['suffix', '-bad.example'],
      ['suffix', 'example.com,DIRECT'],
      ['domain', '1.2.3.4'],
      ['suffix', '1.2.3'],
      ['suffix', ''],
    ] as const)
      expect(() => parseRuleValue(kind, input), `${kind} ${input}`).toThrow()
  })

  it('accepts IPv4 and IPv6 ranges in canonical form and rejects malformed ones', () => {
    expect(parseRuleValue('ip', '192.168.1.5/24')).toBe('192.168.1.0/24')
    expect(parseRuleValue('ip', '8.8.8.8')).toBe('8.8.8.8/32')
    expect(parseRuleValue('ip', '2001:0DB8:0:0:0:0:0:1')).toBe(
      '2001:db8::1/128',
    )
    expect(parseRuleValue('ip', '2001:db8:0:0:1::/64')).toBe('2001:db8::/64')
    expect(parseRuleValue('ip', '::ffff:10.0.0.1/128')).toBe('10.0.0.1/32')
    expect(parseRuleValue('ip', '::ffff:10.1.2.3/104')).toBe('10.0.0.0/8')
    expect(parseRuleValue('ip', 'fe80::/10')).toBe('fe80::/10')
    for (const input of [
      '256.1.1.1',
      '1.2.3',
      '01.2.3.4',
      '1.2.3.4/33',
      '1.2.3.4/x',
      '0.0.0.0/0',
      '::/0',
      '::ffff:0:0/96',
      '2001:db8::/129',
      '2001:db8:::1',
      '1::2::3',
      '2001:db8::g',
      '1:2:3:4:5:6:7:8:9',
      'fe80::1%en0',
      'example.com',
    ])
      expect(() => parseRuleValue('ip', input), input).toThrow()
  })
})

describe('saved exceptions', () => {
  it('survive a storage round trip and drop entries the app could not have written', () => {
    const rules = [
      rule('suffix', 'example.com', 'proxy'),
      rule('ip', '2001:db8::/32', 'direct', false),
    ]
    expect(normalizeRouting(JSON.parse(JSON.stringify({ rules })))).toEqual({
      rules,
    })
    expect(
      normalizeRouting({
        rules: [
          ...rules,
          { ...rules[0], id: 'copy' },
          { id: 'x', kind: 'keyword', value: 'google', action: 'proxy' },
          { id: 'y', kind: 'ip', value: '0.0.0.0/0', action: 'direct' },
          { id: 'z', kind: 'suffix', value: 'example.org', action: 'reject' },
          null,
        ],
      }),
    ).toEqual({ rules })
  })

  it('gives profiles saved before split routing the new defaults with their node selection', () => {
    const saved = normalizeProfile({
      name: '我的订阅',
      yaml: 'proxies:\n  - {name: Hy2, type: hysteria2, server: example.net, port: 8443}\n',
      sourceURL: 'https://example.com/sub',
      selectedNode: 'Hy2',
    })
    const routing = normalizeRouting(undefined)
    expect(routing).toEqual({ rules: [] })
    const config = load(
      runtimeConfig(parseNodes(saved!.sources[0].yaml), saved!.selectedNode!, {
        ...routing,
        chinaLists: true,
      }),
    ) as Runtime & { 'proxy-groups': unknown }
    expect(config['proxy-groups']).toEqual([
      { name: 'Oneday', type: 'select', proxies: ['Hy2'] },
    ])
    expect(config.rules).toContain('RULE-SET,cn-ip,DIRECT')
  })
})
