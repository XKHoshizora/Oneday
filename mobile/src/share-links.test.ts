import { load } from 'js-yaml'
import { describe, expect, it } from 'vitest'

import { nodesToYaml, parseNodes, runtimeConfig } from './profile'
import { mergeLinks, parseShareLinks } from './share-links'

const reality =
  'vless://00000000-0000-4000-8000-000000000001@203.0.113.7:443?encryption=none&flow=xtls-rprx-vision&security=reality&sni=www.example.org&fp=chrome&pbk=test-Public_key&sid=0123456789abcdef&type=tcp&headerType=none&spx=%2F#%E8%8A%82%E7%82%B9-Reality'

describe('share link import', () => {
  it('maps a VLESS REALITY link to the outbound a Clash subscription would provide', () => {
    const yaml = nodesToYaml(parseShareLinks(reality).nodes)
    expect(parseNodes(yaml)).toEqual([
      {
        name: '节点-Reality',
        type: 'vless',
        server: '203.0.113.7',
        port: 443,
        uuid: '00000000-0000-4000-8000-000000000001',
        udp: true,
        network: 'tcp',
        flow: 'xtls-rprx-vision',
        tls: true,
        servername: 'www.example.org',
        'client-fingerprint': 'chrome',
        'reality-opts': {
          'public-key': 'test-Public_key',
          'short-id': '0123456789abcdef',
          'support-x25519mlkem768': true,
        },
      },
    ])
    const runtime = load(runtimeConfig(parseNodes(yaml), '节点-Reality')) as {
      proxies: unknown
    }
    expect(runtime.proxies).toEqual(parseNodes(yaml))
  })

  it('maps Hysteria2 port hopping, obfuscation and TLS options', () => {
    expect(
      parseShareLinks(
        'hy2://fixture%2Bpass@example.net:8443,9000-9100/?sni=example.net&insecure=1&obfs=salamander&obfs-password=fixture-obfs#Hy2',
      ).nodes,
    ).toEqual([
      {
        name: 'Hy2',
        type: 'hysteria2',
        server: 'example.net',
        port: 8443,
        password: 'fixture+pass',
        udp: true,
        ports: '8443,9000-9100',
        sni: 'example.net',
        'skip-cert-verify': true,
        obfs: 'salamander',
        'obfs-password': 'fixture-obfs',
      },
    ])
  })

  it('splits pasted links, keeps spaced names and skips schemes it cannot map', () => {
    const { nodes, skipped } = parseShareLinks(
      `${reality}${reality} vmess://eyJhZGQiOiJleGFtcGxlLmNvbSJ9 hy2://fixture@example.net:443#Tokyo Hy2 `,
    )
    expect(nodes.map((node) => node.name)).toEqual([
      '节点-Reality',
      '节点-Reality 2',
      'Tokyo Hy2',
    ])
    expect(skipped).toEqual(['vmess://'])
    expect(
      mergeLinks(
        nodes,
        parseShareLinks(reality.replace('sid=0123456789abcdef', 'sid=ab'))
          .nodes,
      ).map((node) => [
        node.name,
        (node['reality-opts'] as { 'short-id'?: string })?.['short-id'],
      ]),
    ).toEqual([
      ['节点-Reality', 'ab'],
      ['节点-Reality 2', '0123456789abcdef'],
      ['Tokyo Hy2', undefined],
    ])
    expect(() =>
      parseShareLinks('vmess://eyJhZGQiOiJleGFtcGxlLmNvbSJ9'),
    ).toThrow('vmess://')
    expect(() =>
      parseShareLinks(reality.replace('type=tcp', 'type=xhttp')),
    ).toThrow('xhttp')
  })
})
