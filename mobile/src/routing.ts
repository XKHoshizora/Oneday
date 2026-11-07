export type RuleKind = 'suffix' | 'domain' | 'ip'
export type RuleAction = 'direct' | 'proxy'
export type CustomRule = {
  id: string
  kind: RuleKind
  value: string
  action: RuleAction
  enabled: boolean
}
export type Routing = { rules: CustomRule[] }

export const maxRules = 300

export function normalizeRouting(saved: unknown): Routing {
  const list =
    saved && typeof saved === 'object'
      ? (saved as Record<string, unknown>).rules
      : undefined
  const rules: CustomRule[] = []
  for (const item of Array.isArray(list) ? list : []) {
    if (!item || typeof item !== 'object') continue
    const { id, kind, value, action, enabled } = item as Record<string, unknown>
    if (
      typeof id !== 'string' ||
      (kind !== 'suffix' && kind !== 'domain' && kind !== 'ip') ||
      (action !== 'direct' && action !== 'proxy') ||
      typeof value !== 'string'
    )
      continue
    try {
      const normalized = parseRuleValue(kind, value)
      if (rules.some((rule) => rule.kind === kind && rule.value === normalized))
        continue
      rules.push({
        id,
        kind,
        value: normalized,
        action,
        enabled: enabled !== false,
      })
    } catch {
      /* A value this version cannot read is left out rather than sent to the core. */
    }
  }
  return { rules: rules.slice(0, maxRules) }
}

export function parseRuleValue(kind: RuleKind, input: string): string {
  return kind === 'ip' ? parseCIDR(input) : parseDomain(kind, input)
}

function parseDomain(kind: RuleKind, input: string) {
  let text = input.trim().toLowerCase()
  if (!text) throw new Error('请输入域名。')
  if (/^[a-z][a-z0-9+.-]*:\/\//.test(text)) {
    try {
      text = new URL(text).hostname
    } catch {
      throw new Error('无法从这个链接中读出域名。')
    }
  }
  if (kind === 'suffix') text = text.replace(/^(\*|\+)?\./, '')
  text = text.replace(/\.$/, '')
  if (isIP(text.replace(/^\[|\]$/g, '')))
    throw new Error('这是 IP 地址，请改选「IP 段」。')
  if (text.includes('*'))
    throw new Error(
      kind === 'suffix'
        ? '不需要通配符，域名后缀已包含所有子域名。'
        : '完整域名不支持通配符；要包含子域名，请改选「域名后缀」。',
    )
  if (/[^\x21-\x7e]/.test(text)) {
    // Internationalized names are matched in their ASCII (punycode) form.
    try {
      text = /[/?#@:\\%\s]/.test(text) ? '' : new URL(`http://${text}`).hostname
    } catch {
      text = ''
    }
  }
  const labels = text.split('.')
  if (
    !text ||
    text.length > 253 ||
    labels.some(
      (label) =>
        label.length > 63 || !/^[a-z0-9]([a-z0-9-]*[a-z0-9])?$/.test(label),
    )
  )
    throw new Error(
      '域名格式不正确，只能包含字母、数字、连字符和点，例如 example.com。',
    )
  if (/^\d+$/.test(labels[labels.length - 1]))
    throw new Error('这看起来像不完整的 IP 地址；IP 请改选「IP 段」。')
  return text
}

function isIP(text: string) {
  try {
    parseAddress(text)
    return true
  } catch {
    return false
  }
}

function parseCIDR(input: string) {
  const text = input.trim().toLowerCase()
  if (!text) throw new Error('请输入 IP 地址或 IP 段。')
  const [address, prefix, extra] = text.split('/')
  if (extra !== undefined)
    throw new Error('IP 段格式不正确，例如 192.168.1.0/24。')
  const bytes = parseAddress(address)
  const bits = bytes.length * 8
  if (prefix !== undefined && !/^\d{1,3}$/.test(prefix))
    throw new Error(`前缀长度需为 1 到 ${bits} 的整数。`)
  const length = prefix === undefined ? bits : Number(prefix)
  if (length === 0) throw new Error('不能使用 /0，它会匹配所有地址。')
  if (length > bits) throw new Error(`前缀长度需为 1 到 ${bits} 的整数。`)
  // The core matches IPv4-mapped destinations as IPv4, so a mapped range is stored that way.
  if (
    bytes.length === 16 &&
    bytes.slice(0, 12).join() === '0,0,0,0,0,0,0,0,0,0,255,255'
  ) {
    if (length < 97)
      throw new Error('IPv4 映射地址请直接填写 IPv4 地址或 IP 段。')
    return mask(bytes.slice(12), length - 96)
  }
  return mask(bytes, length)
}

// Host bits are cleared so the stored range is the network the prefix describes.
function mask(bytes: number[], length: number) {
  const network = bytes.map((byte, index) => {
    const keep = Math.min(8, Math.max(0, length - index * 8))
    return byte & (0xff << (8 - keep)) & 0xff
  })
  return `${formatAddress(network)}/${length}`
}

function parseAddress(text: string): number[] {
  if (text.includes(':')) return parseIPv6(text)
  if (/^[\d.]+$/.test(text)) return parseIPv4(text)
  throw new Error('IP 地址格式不正确，例如 192.168.1.0/24 或 2001:db8::/32。')
}

function parseIPv4(text: string) {
  const parts = text.split('.')
  if (
    parts.length !== 4 ||
    parts.some((part) => !/^(0|[1-9]\d{0,2})$/.test(part) || Number(part) > 255)
  )
    throw new Error(
      'IPv4 地址格式不正确，应为四段 0 到 255 的数字，例如 192.168.1.1。',
    )
  return parts.map(Number)
}

function parseIPv6(text: string) {
  const invalid = new Error('IPv6 地址格式不正确，例如 2001:db8::1。')
  const halves = text.split('::')
  if (halves.length > 2) throw invalid
  const groups = (half: string) => (half ? half.split(':') : [])
  const head = groups(halves[0])
  const tail = halves.length === 2 ? groups(halves[1]) : []
  const words: number[] = []
  const read = (list: string[], last: boolean) =>
    list.flatMap((group, index) => {
      if (last && index === list.length - 1 && group.includes('.')) {
        const [a, b, c, d] = parseIPv4(group)
        return [(a << 8) | b, (c << 8) | d]
      }
      if (!/^[0-9a-f]{1,4}$/.test(group)) throw invalid
      return [parseInt(group, 16)]
    })
  const front = read(head, halves.length === 1)
  const back = read(tail, true)
  const missing = 8 - front.length - back.length
  if (halves.length === 1 ? missing !== 0 : missing < 1) throw invalid
  words.push(...front, ...Array<number>(Math.max(0, missing)).fill(0), ...back)
  return words.flatMap((word) => [word >> 8, word & 0xff])
}

function formatAddress(bytes: number[]) {
  if (bytes.length === 4) return bytes.join('.')
  const words = Array.from({ length: 8 }, (_, index) =>
    ((bytes[index * 2] << 8) | bytes[index * 2 + 1]).toString(16),
  )
  // RFC 5952: compress the first longest run of two or more zero groups.
  let best = { start: -1, length: 1 }
  for (let start = 0; start < 8; ) {
    if (words[start] !== '0') {
      start++
      continue
    }
    let end = start
    while (end < 8 && words[end] === '0') end++
    if (end - start > best.length) best = { start, length: end - start }
    start = end
  }
  if (best.start < 0) return words.join(':')
  const left = words.slice(0, best.start).join(':')
  const right = words.slice(best.start + best.length).join(':')
  return `${left}::${right}`
}

function prefixLength(value: string) {
  return Number(value.split('/')[1])
}

// More specific rules come first: exact domains, then longer suffixes, then smaller IP ranges.
// Distinct rules of equal rank never match the same destination, so this order settles every overlap.
export function sortRules(rules: CustomRule[]) {
  const rank = (rule: CustomRule) =>
    rule.kind === 'domain'
      ? 0
      : rule.kind === 'suffix'
        ? 1000 - rule.value.split('.').length
        : 2000 - prefixLength(rule.value)
  return [...rules].sort(
    (a, b) =>
      rank(a) - rank(b) || (a.value < b.value ? -1 : a.value > b.value ? 1 : 0),
  )
}

export function ruleLines(rules: CustomRule[], proxy: string) {
  return sortRules(rules)
    .filter((rule) => rule.enabled)
    .map((rule) => {
      const target = rule.action === 'direct' ? 'DIRECT' : proxy
      if (rule.kind === 'domain') return `DOMAIN,${rule.value},${target}`
      if (rule.kind === 'suffix') return `DOMAIN-SUFFIX,${rule.value},${target}`
      return `${rule.value.includes(':') ? 'IP-CIDR6' : 'IP-CIDR'},${rule.value},${target}`
    })
}
