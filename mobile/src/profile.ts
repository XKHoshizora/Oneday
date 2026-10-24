import { dump, load } from 'js-yaml'

export type ClashNode = Record<string, unknown> & { name: string; type: string; server: string; port: number }
export type Profile = { name: string; yaml: string; sourceURL?: string; selectedNode?: string }

export function parseNodes(yaml: string): ClashNode[] {
  let document: unknown
  try { document = load(yaml) } catch { throw new Error('配置不是有效的 Clash YAML。') }
  if (!document || typeof document !== 'object' || Array.isArray(document)) throw new Error('需要 Clash/Mihomo YAML 配置。')
  const proxies = (document as Record<string, unknown>).proxies
  if (!Array.isArray(proxies) || proxies.length === 0) throw new Error('配置中没有节点。当前原型需要包含 proxies 列表的 Clash 订阅。')
  const names = new Set<string>()
  return proxies.map((value: unknown) => {
    if (!value || typeof value !== 'object' || Array.isArray(value)) throw new Error('节点配置不完整。')
    const node = value as ClashNode
    if (typeof node.name !== 'string' || !node.name || typeof node.type !== 'string' || typeof node.server !== 'string' || !Number.isInteger(node.port) || node.port < 1 || node.port > 65535) throw new Error('节点缺少有效的名称、协议、服务器或端口。')
    if (names.has(node.name)) throw new Error('配置中存在重复的节点名称。')
    names.add(node.name)
    return node
  })
}

export function runtimeConfig(yaml: string, selected: string): string {
  const nodes = parseNodes(yaml)
  if (!nodes.some(node => node.name === selected)) throw new Error('请选择有效节点。')
  // Keep each outbound intact: REALITY, TLS and Hysteria2 extensions are core-owned.
  return dump({
    mode: 'rule', 'log-level': 'warning', ipv6: true, 'allow-lan': false,
    'find-process-mode': 'off', 'unified-delay': true,
    tun: { enable: true, stack: 'gvisor', 'auto-route': true, 'auto-detect-interface': true, 'dns-hijack': ['any:53'], mtu: 1400 },
    dns: {
      enable: true, ipv6: true, 'enhanced-mode': 'fake-ip', 'fake-ip-range': '198.18.0.1/16',
      'default-nameserver': ['1.1.1.1', '8.8.8.8'],
      nameserver: ['https://1.1.1.1/dns-query', 'https://8.8.8.8/dns-query'],
      'proxy-server-nameserver': ['https://1.1.1.1/dns-query', 'https://8.8.8.8/dns-query'],
    },
    proxies: nodes,
    'proxy-groups': [{ name: 'Oneday', type: 'select', proxies: [selected] }],
    rules: ['IP-CIDR,127.0.0.0/8,DIRECT,no-resolve', 'IP-CIDR,192.168.0.0/16,DIRECT,no-resolve', 'IP-CIDR,10.0.0.0/8,DIRECT,no-resolve', 'IP-CIDR,172.16.0.0/12,DIRECT,no-resolve', 'MATCH,Oneday'],
  }, { noRefs: true, lineWidth: -1 })
}
