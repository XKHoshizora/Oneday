import { load } from 'js-yaml'
import { describe, expect, it } from 'vitest'

import { parseNodes, runtimeConfig } from './profile'

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
    const result = load(runtimeConfig(fixture, 'Hy2')) as Record<
      string,
      unknown
    >
    expect(result.proxies).toEqual(before)
    expect(result['proxy-groups']).toEqual([
      { name: 'Oneday', type: 'select', proxies: ['Hy2'] },
    ])
    expect(result.rules).toContain('MATCH,Oneday')
    expect(result).not.toHaveProperty('external-controller')
  })

  it('rejects unsupported containers and invalid selections before native connection', () => {
    expect(() => parseNodes('<html>not a subscription</html>')).toThrow()
    expect(() => parseNodes('proxy-providers: {}')).toThrow()
    expect(() => runtimeConfig(fixture, 'missing')).toThrow()
  })
})
