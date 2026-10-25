import { type ClashNode, uniqueName } from './profile'

const scheme =
  '(?:vless|hysteria2|hy2|vmess|trojan|ssr|ss|tuic|hysteria|socks5?|wireguard|anytls)://'
// A link runs until the next scheme: pasting into a single-line input strips line breaks,
// and node names may contain spaces.
const linkPattern = new RegExp(`${scheme}[\\s\\S]*?(?=${scheme}|$)`, 'gi')
const hysteria2Pattern =
  /^(?:hysteria2|hy2):\/\/(?:([^@/?#]*)@)?(\[[^\]]+\]|[^:/?#]+)(?::([\d,-]+))?\/?(?:\?([^#]*))?(?:#(.*))?$/i

export function parseShareLinks(text: string): {
  nodes: ClashNode[]
  skipped: string[]
} {
  const nodes: ClashNode[] = []
  const skipped = new Set<string>()
  const names = new Set<string>()
  for (const chunk of text.match(linkPattern) ?? []) {
    const link = trimLink(chunk)
    const protocol = link.slice(0, link.indexOf(':')).toLowerCase()
    if (
      protocol !== 'vless' &&
      protocol !== 'hysteria2' &&
      protocol !== 'hy2'
    ) {
      skipped.add(`${protocol}://`)
      continue
    }
    const node = protocol === 'vless' ? vless(link) : hysteria2(link)
    nodes.push({ ...node, name: uniqueName(node.name, names) })
  }
  if (nodes.length === 0)
    throw new Error(
      skipped.size > 0
        ? `暂不支持 ${[...skipped].join('、')} 链接。目前支持订阅链接，以及 vless:// 和 hysteria2:// 节点链接。`
        : '无法识别的链接。请粘贴 https 订阅链接，或 vless:// 和 hysteria2:// 节点链接。',
    )
  return { nodes, skipped: [...skipped] }
}

// A pasted link whose name is already listed replaces that node, so a corrected link
// fixes the old entry instead of sitting next to it.
export function mergeLinks(existing: ClashNode[], added: ClashNode[]) {
  const pending = new Map(added.map((node) => [node.name, node]))
  const merged = existing.map((node) => {
    const replacement = pending.get(node.name)
    pending.delete(node.name)
    return replacement ?? node
  })
  return [...merged, ...pending.values()]
}

// Whitespace only belongs to a link inside its #name.
function trimLink(chunk: string): string {
  const hash = chunk.indexOf('#')
  const space = (hash < 0 ? chunk : chunk.slice(0, hash)).search(/\s/)
  return (space < 0 ? chunk : chunk.slice(0, space)).trim()
}

function vless(link: string): ClashNode {
  let url: URL
  try {
    url = new URL(link)
  } catch {
    throw new Error('无法解析 vless:// 链接。')
  }
  const query = parseQuery(url.search.slice(1))
  const server = url.hostname.replace(/^\[|\]$/g, '')
  const port = Number(url.port)
  const uuid = decode(url.username)
  if (!uuid || !server || !port)
    throw new Error('vless:// 链接缺少用户 ID、服务器或端口。')

  const security = query.security || 'none'
  const network = query.type || 'tcp'
  const node: ClashNode = {
    name: decode(url.hash.slice(1)) || `${server}:${port}`,
    type: 'vless',
    server,
    port,
    uuid,
    udp: true,
    network,
  }
  if (query.encryption && query.encryption !== 'none')
    node.encryption = query.encryption
  if (query.flow) node.flow = query.flow

  if (security === 'tls' || security === 'reality') {
    node.tls = true
    if (query.sni) node.servername = query.sni
    if (query.fp) node['client-fingerprint'] = query.fp
    if (query.alpn) node.alpn = query.alpn.split(',')
    if (query.allowInsecure === '1' || query.insecure === '1')
      node['skip-cert-verify'] = true
  } else if (security !== 'none') {
    throw new Error(`暂不支持 ${security} 安全类型。`)
  }
  if (security === 'reality') {
    if (!query.pbk) throw new Error('REALITY 链接缺少公钥（pbk）。')
    // Links don't carry this flag. Xray clients offer X25519MLKEM768 by default and current
    // REALITY servers fail authentication without it, but mihomo leaves it off unless set.
    node['reality-opts'] = {
      'public-key': query.pbk,
      'short-id': query.sid ?? '',
      'support-x25519mlkem768': true,
    }
  }

  if (network === 'ws') {
    node['ws-opts'] = {
      path: query.path || '/',
      ...(query.host ? { headers: { Host: query.host } } : {}),
    }
  } else if (network === 'grpc') {
    node['grpc-opts'] = { 'grpc-service-name': query.serviceName ?? '' }
  } else if (network === 'h2') {
    node['h2-opts'] = {
      path: query.path || '/',
      ...(query.host ? { host: query.host.split(',') } : {}),
    }
  } else if (network !== 'tcp') {
    throw new Error(`暂不支持 ${network} 传输方式。`)
  } else if (query.headerType && query.headerType !== 'none') {
    throw new Error(`暂不支持 TCP 的 ${query.headerType} 伪装。`)
  }
  return node
}

function hysteria2(link: string): ClashNode {
  const match = link.match(hysteria2Pattern)
  if (!match) throw new Error('无法解析 hysteria2:// 链接。')
  const [, auth = '', host, portSpec = '443', rawQuery = '', rawName = ''] =
    match
  const query = parseQuery(rawQuery)
  const server = host.replace(/^\[|\]$/g, '')
  const port = Number(portSpec.split(/[,-]/)[0])
  const password = decode(auth)
  if (!password) throw new Error('hysteria2:// 链接缺少认证密码。')

  const node: ClashNode = {
    name: decode(rawName) || `${server}:${port}`,
    type: 'hysteria2',
    server,
    port,
    password,
    udp: true,
  }
  const ports = query.mport || (/[,-]/.test(portSpec) ? portSpec : '')
  if (ports) node.ports = ports
  if (query.sni) node.sni = query.sni
  if (query.insecure === '1') node['skip-cert-verify'] = true
  if (query.obfs && query.obfs !== 'none') {
    node.obfs = query.obfs
    if (query['obfs-password']) node['obfs-password'] = query['obfs-password']
  }
  if (query.pinSHA256)
    node.fingerprint = query.pinSHA256.replace(/:/g, '').toLowerCase()
  if (query.alpn) node.alpn = query.alpn.split(',')
  return node
}

// URLSearchParams decodes "+" as a space, which would corrupt base64 values.
function parseQuery(raw: string): Record<string, string> {
  const result: Record<string, string> = {}
  for (const part of raw.split('&')) {
    if (!part) continue
    const index = part.indexOf('=')
    const key = decode(index < 0 ? part : part.slice(0, index))
    result[key] = decode(index < 0 ? '' : part.slice(index + 1))
  }
  return result
}

function decode(value: string): string {
  try {
    return decodeURIComponent(value)
  } catch {
    return value
  }
}
