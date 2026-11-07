import { dump, load } from 'js-yaml'

import { type CustomRule, ruleLines } from './routing'

export type ClashNode = Record<string, unknown> & {
  name: string
  type: string
  server: string
  port: number
}
export type Source = {
  id: string
  kind: 'subscription' | 'file' | 'standalone'
  name: string
  url?: string
  yaml: string
}
export type Profile = { sources: Source[]; selectedNode?: string }
export type Group = { source: Source; nodes: ClashNode[] }

export const standaloneName = '独立节点'

// Profiles saved before node groups held one source; link imports were named 「节点链接」.
export function normalizeProfile(saved: unknown): Profile | undefined {
  if (!saved || typeof saved !== 'object') return undefined
  const value = saved as Record<string, unknown>
  if (Array.isArray(value.sources)) return value as Profile
  if (typeof value.yaml !== 'string') return undefined
  const name = typeof value.name === 'string' ? value.name : '配置'
  const url = typeof value.sourceURL === 'string' ? value.sourceURL : undefined
  const source: Source = url
    ? {
        id: 'subscription-1',
        kind: 'subscription',
        name,
        url,
        yaml: value.yaml,
      }
    : name === '节点链接'
      ? {
          id: 'standalone',
          kind: 'standalone',
          name: standaloneName,
          yaml: value.yaml,
        }
      : { id: 'file-1', kind: 'file', name, yaml: value.yaml }
  const selectedNode =
    typeof value.selectedNode === 'string' ? value.selectedNode : undefined
  return { sources: [source], selectedNode }
}

export function uniqueName(name: string, taken: Set<string>) {
  let result = name
  for (let index = 2; taken.has(result); index++) result = `${name} ${index}`
  taken.add(result)
  return result
}

// Node names key the runtime config, so a name repeated by a later group gets a suffix.
// Independent nodes come last and give way to subscriptions and files.
export function groupNodes(sources: Source[]): Group[] {
  const taken = new Set<string>()
  return [...sources]
    .sort(
      (a, b) =>
        Number(a.kind === 'standalone') - Number(b.kind === 'standalone'),
    )
    .map((source) => ({
      source,
      nodes: parseNodes(source.yaml).map((node) => ({
        ...node,
        name: uniqueName(node.name, taken),
      })),
    }))
}

export function nodesToYaml(nodes: ClashNode[]) {
  return dump({ proxies: nodes }, { noRefs: true, lineWidth: -1 })
}

export function parseNodes(yaml: string): ClashNode[] {
  let document: unknown
  try {
    document = load(yaml)
  } catch {
    throw new Error('配置不是有效的 Clash YAML。')
  }
  if (!document || typeof document !== 'object' || Array.isArray(document))
    throw new Error('需要 Clash/Mihomo YAML 配置。')
  const proxies = (document as Record<string, unknown>).proxies
  if (!Array.isArray(proxies) || proxies.length === 0)
    throw new Error(
      '配置中没有节点。当前原型需要包含 proxies 列表的 Clash 订阅。',
    )
  const names = new Set<string>()
  // A YAML document has no more values than characters, so copying beyond its length
  // means anchors are amplifying it.
  const budget = { left: yaml.length }
  return proxies.map((value: unknown) => {
    if (!value || typeof value !== 'object' || Array.isArray(value))
      throw new Error('节点配置不完整。')
    const node = detach(value, budget, 0, new Set()) as ClashNode
    if (
      typeof node.name !== 'string' ||
      !node.name ||
      typeof node.type !== 'string' ||
      typeof node.server !== 'string' ||
      !Number.isInteger(node.port) ||
      node.port < 1 ||
      node.port > 65535
    )
      throw new Error('节点缺少有效的名称、协议、服务器或端口。')
    if (names.has(node.name)) throw new Error('配置中存在重复的节点名称。')
    names.add(node.name)
    return node
  })
}

// Runtime serialization uses `noRefs`, which would expand shared or cyclic anchors in place.
function detach(
  value: unknown,
  budget: { left: number },
  depth: number,
  path: Set<object>,
): unknown {
  if (--budget.left < 0 || depth > 16)
    throw new Error('配置中的 YAML 引用过多或嵌套过深。')
  if (value === null || typeof value !== 'object') return value
  if (
    !Array.isArray(value) &&
    Object.getPrototypeOf(value) !== Object.prototype
  )
    return value
  if (path.has(value)) throw new Error('配置中的 YAML 引用存在循环。')
  path.add(value)
  const copy = Array.isArray(value)
    ? value.map((item) => detach(item, budget, depth + 1, path))
    : Object.fromEntries(
        Object.entries(value).map(([key, item]) => [
          key,
          detach(item, budget, depth + 1, path),
        ]),
      )
  path.delete(value)
  return copy
}

const proxyGroup = 'Oneday'
const domesticDNS = [
  'https://223.5.5.5/dns-query',
  'https://1.12.12.12/dns-query',
]
// Private, shared, link-local, loopback and multicast ranges, and names that resolve into them,
// are reached directly unless an exception says otherwise.
const localRanges = [
  'IP-CIDR,10.0.0.0/8,DIRECT',
  'IP-CIDR,100.64.0.0/10,DIRECT',
  'IP-CIDR,127.0.0.0/8,DIRECT',
  'IP-CIDR,169.254.0.0/16,DIRECT',
  'IP-CIDR,172.16.0.0/12,DIRECT',
  'IP-CIDR,192.168.0.0/16,DIRECT',
  'IP-CIDR,224.0.0.0/4,DIRECT',
  'IP-CIDR6,::1/128,DIRECT',
  'IP-CIDR6,fc00::/7,DIRECT',
  'IP-CIDR6,fe80::/10,DIRECT',
  'IP-CIDR6,ff00::/8,DIRECT',
]

const chinaProviders = {
  'cn-domain': {
    type: 'file',
    behavior: 'domain',
    format: 'mrs',
    path: 'routing/cn-domain.mrs',
  },
  'cn-ip': {
    type: 'file',
    behavior: 'ipcidr',
    format: 'mrs',
    path: 'routing/cn-ip.mrs',
  },
}

// `chinaLists` says whether the app installed the bundled China lists. Their paths are relative to
// the core's working directory, where the app's RoutingData copies them.
export type RuntimeRouting = { rules: CustomRule[]; chinaLists: boolean }

export function runtimeConfig(
  nodes: ClashNode[],
  selected: string,
  routing: RuntimeRouting,
): string {
  if (!nodes.some((node) => node.name === selected))
    throw new Error('请选择有效节点。')
  const { chinaLists } = routing
  // Keep each outbound intact: REALITY, TLS and Hysteria2 extensions are core-owned.
  return dump(
    {
      mode: 'rule',
      'log-level': 'warning',
      ipv6: true,
      'allow-lan': false,
      'find-process-mode': 'off',
      'unified-delay': true,
      // Otherwise UDP that reaches a node without UDP support falls through to a direct connection.
      'x-clash-udp-unsupported': 'REJECT',
      tun: {
        enable: true,
        stack: 'gvisor',
        'auto-route': true,
        'auto-detect-interface': true,
        'dns-hijack': ['any:53'],
        mtu: 1400,
      },
      dns: {
        enable: true,
        ipv6: true,
        'enhanced-mode': 'fake-ip',
        'fake-ip-range': '198.18.0.1/16',
        'default-nameserver': ['223.5.5.5', '119.29.29.29'],
        // Lookups outside the China list go through the selected node, so they are neither
        // tampered with on the way nor answered with addresses meant for mainland users.
        nameserver: [
          `https://1.1.1.1/dns-query#${proxyGroup}`,
          `https://8.8.8.8/dns-query#${proxyGroup}`,
        ],
        ...(chinaLists
          ? { 'nameserver-policy': { 'rule-set:cn-domain': domesticDNS } }
          : {}),
        // Node servers and direct connections resolve without the tunnel, so neither can loop.
        'proxy-server-nameserver': [
          ...domesticDNS,
          'https://1.1.1.1/dns-query',
        ],
        'direct-nameserver': domesticDNS,
      },
      proxies: nodes,
      'proxy-groups': [
        { name: proxyGroup, type: 'select', proxies: [selected] },
      ],
      ...(chinaLists ? { 'rule-providers': chinaProviders } : {}),
      // Exceptions first, then local networks, then the China lists; anything else uses the node.
      rules: [
        ...ruleLines(routing.rules, proxyGroup),
        ...localRanges,
        ...(chinaLists
          ? ['RULE-SET,cn-domain,DIRECT', 'RULE-SET,cn-ip,DIRECT']
          : []),
        `MATCH,${proxyGroup}`,
      ],
    },
    { noRefs: true, lineWidth: -1 },
  )
}
