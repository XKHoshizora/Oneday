import { load } from 'js-yaml'
import { describe, expect, it } from 'vitest'

import {
  groupNodes,
  normalizeProfile,
  parseNodes,
  runtimeConfig,
} from './profile'

const fixture = `proxies:
  - name: Reality
    type: vless
    server: example.com
    port: 443
    uuid: 00000000-0000-4000-8000-000000000001
    tls: true
    flow: xtls-rprx-vision
    servername: www.example.org
    client-fingerprint: chrome
    reality-opts:
      public-key: test-public-key
      short-id: "0123456789abcdef"
  - name: Hy2
    type: hysteria2
    server: example.net
    port: 8443
    password: fixture-password
    sni: example.net
    obfs: salamander
    obfs-password: fixture-obfs
    ports: 8443-8450
    skip-cert-verify: false
`

describe('Clash subscription import', () => {
  it('preserves REALITY, Vision and Hysteria2 options through runtime generation', () => {
    const before = parseNodes(fixture)
    const result = load(runtimeConfig(before, 'Hy2')) as Record<string, unknown>
    expect(result.proxies).toEqual(before)
    expect(result['proxy-groups']).toEqual([
      { name: 'Oneday', type: 'select', proxies: ['Hy2'] },
    ])
    expect(result.rules).toContain('MATCH,Oneday')
    expect(result).not.toHaveProperty('external-controller')
  })

  it('rejects cyclic or exponentially shared YAML aliases before runtime generation', () => {
    const node = 'type: vless\n    server: example.com\n    port: 443'
    const shared = `tls: &tls {servername: example.org}\nproxies:\n  - name: A\n    ${node}\n    opts: *tls\n  - name: B\n    ${node}\n    opts: *tls\n`
    expect(parseNodes(shared).map((item) => item.opts)).toEqual([
      { servername: 'example.org' },
      { servername: 'example.org' },
    ])
    expect(() =>
      parseNodes(
        `proxies:\n  - &loop\n    name: Loop\n    ${node}\n    self: *loop\n`,
      ),
    ).toThrow('引用')
    const levels = Array.from(
      { length: 30 },
      (_, index) => `l${index + 1}: &l${index + 1} [*l${index}, *l${index}]`,
    ).join('\n')
    const bomb = `l0: &l0 [x]\n${levels}\nproxies:\n  - name: Bomb\n    ${node}\n    extra: *l30\n`
    const started = performance.now()
    expect(() => parseNodes(bomb)).toThrow('引用')
    expect(performance.now() - started).toBeLessThan(500)
  })

  it('migrates single-source profiles and keeps node names unique across groups', () => {
    const links = normalizeProfile({ name: '节点链接', yaml: fixture })
    const subscription = normalizeProfile({
      name: '我的订阅',
      yaml: fixture,
      sourceURL: 'https://example.com/sub',
      selectedNode: 'Hy2',
    })
    expect(links?.sources[0]).toMatchObject({
      kind: 'standalone',
      name: '独立节点',
    })
    expect(subscription).toMatchObject({
      selectedNode: 'Hy2',
      sources: [{ kind: 'subscription', url: 'https://example.com/sub' }],
    })
    const groups = groupNodes([...links!.sources, ...subscription!.sources])
    expect(groups.map((group) => group.source.kind)).toEqual([
      'subscription',
      'standalone',
    ])
    expect(groups[1].nodes.map((node) => node.name)).toEqual([
      'Reality 2',
      'Hy2 2',
    ])
  })

  it('rejects unsupported containers and invalid selections before native connection', () => {
    expect(() => parseNodes('<html>not a subscription</html>')).toThrow()
    expect(() => parseNodes('proxy-providers: {}')).toThrow()
    expect(() => runtimeConfig(parseNodes(fixture), 'missing')).toThrow()
  })
})
