import { type CSSProperties, useEffect, useRef, useState } from 'react'

import { callNative, type AppState } from './bridge'
import {
  parseNodes,
  runtimeConfig,
  type ClashNode,
  type Profile,
} from './profile'
import { shareLinksToYaml } from './share-links'
import { Verse } from './Verse'

const statusText: Record<string, string> = {
  connected: '已连接',
  connecting: '正在连接',
  reasserting: '正在重连',
  disconnecting: '正在断开',
  disconnected: '未连接',
  invalid: '未连接',
}

export function App() {
  const [state, setState] = useState<AppState>({ status: 'disconnected' })
  const [profile, setProfile] = useState<Profile>()
  const [nodes, setNodes] = useState<ClashNode[]>([])
  const [selected, setSelected] = useState('')
  const [url, setURL] = useState('')
  const [busy, setBusy] = useState(false)
  // Only connect and disconnect spin the power button; imports also set busy.
  const [toggling, setToggling] = useState(false)
  const [error, setError] = useState('')
  // Bumped on each import so the profile and node list replay their entrance.
  const [revision, setRevision] = useState(0)
  const fileInputRef = useRef<HTMLInputElement>(null)
  const connected =
    state.status === 'connected' || state.status === 'reasserting'
  const transition =
    state.status === 'connecting' || state.status === 'disconnecting'
  const statusLabel = busy ? '请稍候' : statusText[state.status] || '未连接'

  useEffect(() => {
    let active = true
    const refresh = async () => {
      try {
        const next = await callNative<AppState>('getState')
        if (!active) return
        setState(next)
        if (next.lastError) setError(next.lastError)
      } catch {
        /* The next foreground refresh reconciles transient native failures. */
      }
    }
    callNative<AppState>('getState')
      .then((next) => {
        if (!active) return
        setState(next)
        if (next.profile) {
          const items = parseNodes(next.profile.yaml)
          setProfile(next.profile)
          setNodes(items)
          setSelected(next.profile.selectedNode || items[0].name)
        }
      })
      .catch((failure) => {
        if (active)
          setError(failure instanceof Error ? failure.message : String(failure))
      })
    const timer = window.setInterval(() => {
      if (!document.hidden) void refresh()
    }, 1500)
    document.addEventListener('visibilitychange', refresh)
    return () => {
      active = false
      window.clearInterval(timer)
      document.removeEventListener('visibilitychange', refresh)
    }
  }, [])

  async function save(yaml: string, name: string, sourceURL?: string) {
    const items = parseNodes(yaml)
    const selectedNode = items.some((node) => node.name === selected)
      ? selected
      : items[0].name
    const next: Profile = { yaml, name, sourceURL, selectedNode }
    await callNative('saveProfile', { profile: next })
    setProfile(next)
    setNodes(items)
    setSelected(selectedNode)
    setURL('')
    setRevision((value) => value + 1)
  }

  async function action(task: () => Promise<void>) {
    setBusy(true)
    setError('')
    try {
      await task()
    } catch (failure) {
      setError(failure instanceof Error ? failure.message : String(failure))
    } finally {
      setBusy(false)
    }
  }

  async function importInput(input: string) {
    await action(async () => {
      if (!/^https?:\/\//i.test(input)) {
        const { yaml, skipped } = shareLinksToYaml(input)
        await save(yaml, '节点链接')
        if (skipped.length > 0)
          setError(`已跳过暂不支持的 ${skipped.join('、')} 链接。`)
        return
      }
      const result = await callNative<{ content: string }>(
        'fetchSubscription',
        { url: input },
      )
      await save(result.content, '我的订阅', input)
    })
  }

  async function toggle() {
    setToggling(true)
    await action(async () => {
      if (connected) {
        await callNative('disconnect')
        setState((current) => ({ ...current, status: 'disconnecting' }))
        return
      }
      if (!profile) return
      await callNative('saveProfile', {
        profile: { ...profile, selectedNode: selected },
      })
      await callNative('connect', {
        configuration: runtimeConfig(profile.yaml, selected),
        nodeName: selected,
      })
      setState((current) => ({ ...current, status: 'connecting' }))
    })
    setToggling(false)
  }

  return (
    <main>
      <header>
        <div className="wordmark">
          <span className="sun" aria-hidden="true" />
          有朝<span className="roman">Oneday</span>
        </div>
      </header>
      <section className="connection">
        <Verse />
        <button
          className={`power ${connected ? 'active' : ''} ${toggling || transition ? 'pending' : ''}`}
          onClick={toggle}
          disabled={busy || transition || (!profile && !connected)}
          aria-label={connected ? '断开连接' : '连接 VPN'}
        >
          <svg viewBox="0 0 48 48" aria-hidden="true">
            <path d="M24 6v17M13 12a17 17 0 1 0 22 0" />
          </svg>
        </button>
        <div className="connection-status" role="status">
          <span className={connected ? 'dot on' : 'dot'} />
          <span key={statusLabel} className="status-text">
            {statusLabel}
          </span>
        </div>
        {state.tunnelAvailable === false && (
          <p className="route-label">
            模拟器模式 · 可测试订阅
            <br />
            VPN 连接需在 iPhone 上验证
          </p>
        )}
        {connected && <p className="route-label">全局连接 · {selected}</p>}
      </section>

      {error && (
        <div className="error" role="alert">
          {error}
          <button onClick={() => setError('')} aria-label="关闭提示">
            ×
          </button>
        </div>
      )}

      <section className="card">
        <div className="section-title">
          <h2>配置</h2>
          {profile?.sourceURL && (
            <button
              className="text-button"
              disabled={busy || connected || transition}
              onClick={() =>
                profile.sourceURL && importInput(profile.sourceURL)
              }
            >
              更新
            </button>
          )}
        </div>
        {profile ? (
          <div
            key={revision}
            className={revision ? 'profile-summary fresh' : 'profile-summary'}
          >
            <span className="profile-icon">↗</span>
            <div>
              <strong>{profile.name}</strong>
              <p>{nodes.length} 个节点 · 仅保存在本机</p>
            </div>
          </div>
        ) : (
          <p className="muted">
            添加 Clash / Mihomo 订阅，或粘贴 vless:// 与 hysteria2:// 节点链接。
          </p>
        )}
        <form
          onSubmit={(event) => {
            event.preventDefault()
            if (url.trim()) void importInput(url.trim())
          }}
        >
          <label className="sr-only" htmlFor="subscription">
            订阅链接或节点链接
          </label>
          <input
            id="subscription"
            type="text"
            inputMode="url"
            placeholder="粘贴订阅或节点链接"
            value={url}
            onChange={(event) => setURL(event.target.value)}
            autoCapitalize="none"
            autoCorrect="off"
            spellCheck={false}
            disabled={busy || connected || transition}
          />
          <button
            className="import-button"
            disabled={busy || connected || transition || !url.trim()}
          >
            导入
          </button>
        </form>
        <input
          ref={fileInputRef}
          className="sr-only"
          type="file"
          accept=".yaml,.yml,text/yaml,application/yaml"
          onChange={(event) => {
            const file = event.target.files?.[0]
            if (file)
              void action(async () => {
                if (file.size > 4 * 1024 * 1024)
                  throw new Error('配置文件不能超过 4 MB。')
                await save(await file.text(), file.name)
              })
            event.target.value = ''
          }}
        />
        <button
          className="text-button file-button"
          disabled={busy || connected || transition}
          onClick={() => fileInputRef.current?.click()}
        >
          或从文件导入 ↗
        </button>
      </section>

      {nodes.length > 0 && (
        <section
          key={revision}
          className={revision ? 'card nodes fresh' : 'card nodes'}
        >
          <div className="section-title">
            <h2>选择节点</h2>
            <span className="muted">{nodes.length}</span>
          </div>
          {nodes.map((node, index) => (
            <button
              key={node.name}
              className={`node ${selected === node.name ? 'selected' : ''}`}
              style={{ '--i': Math.min(index, 8) } as CSSProperties}
              disabled={busy || connected || transition}
              onClick={() => setSelected(node.name)}
            >
              <span className="node-symbol">
                {node.type === 'hysteria2' ? '≈' : '↗'}
              </span>
              <span className="node-info">
                <strong>{node.name}</strong>
                <small>
                  {node.type === 'vless' && node['reality-opts']
                    ? 'VLESS + REALITY'
                    : node.type.toUpperCase()}
                </small>
              </span>
              <span className="radio" />
            </button>
          ))}
        </section>
      )}
      <footer>
        <strong>有朝 · Oneday · いつか</strong>
        <p>基于 Clash Verge Rev 与 mihomo</p>
        <p>0.1.0 · 个人签名自用</p>
      </footer>
    </main>
  )
}
