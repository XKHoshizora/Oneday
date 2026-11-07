import {
  type CSSProperties,
  Fragment,
  useEffect,
  useRef,
  useState,
} from 'react'

import { callNative, type AppState } from './bridge'
import { Power } from './Power'
import {
  type ClashNode,
  type Group,
  groupNodes,
  nodesToYaml,
  normalizeProfile,
  parseNodes,
  type Profile,
  runtimeConfig,
  type Source,
  standaloneName,
} from './profile'
import { type CustomRule, normalizeRouting, type Routing } from './routing'
import { Rules } from './Rules'
import { mergeLinks, parseShareLinks } from './share-links'
import { SwipeRow } from './SwipeRow'
import { Verse } from './Verse'

const statusText: Record<string, string> = {
  connected: '已连接',
  connecting: '正在连接',
  reasserting: '正在重连',
  disconnecting: '正在断开',
  disconnected: '未连接',
  invalid: '未连接',
}

function formatRate(bytes: number) {
  if (bytes < 1024) return `${Math.round(bytes)} B/s`
  if (bytes < 1024 * 1024) return `${Math.round(bytes / 1024)} KB/s`
  return `${(bytes / 1024 / 1024).toFixed(1)} MB/s`
}

function formatDuration(milliseconds: number) {
  const seconds = Math.max(0, Math.floor(milliseconds / 1000))
  const clock = [Math.floor(seconds / 60) % 60, seconds % 60]
    .map((part) => String(part).padStart(2, '0'))
    .join(':')
  return seconds >= 3600 ? `${Math.floor(seconds / 3600)}:${clock}` : clock
}

function protocolLabel(node: ClashNode) {
  return node.type === 'vless' && node['reality-opts']
    ? 'VLESS + REALITY'
    : node.type.toUpperCase()
}

const pages = ['连接与节点', '分流']

const motion = (): ScrollBehavior =>
  matchMedia('(prefers-reduced-motion: reduce)').matches ? 'auto' : 'smooth'

function groupTitle(source: Source) {
  return source.kind === 'subscription' ? `订阅 · ${source.name}` : source.name
}

export function App() {
  const [state, setState] = useState<AppState>({ status: 'disconnected' })
  const [profile, setProfile] = useState<Profile>()
  const [routing, setRouting] = useState<Routing>({ rules: [] })
  const [routingData, setRoutingData] = useState<string>()
  const [groups, setGroups] = useState<Group[]>([])
  const [selected, setSelected] = useState('')
  const [url, setURL] = useState('')
  const [busy, setBusy] = useState(false)
  // Only connect and disconnect spin the power button; imports also set busy.
  const [toggling, setToggling] = useState(false)
  const [error, setError] = useState('')
  // Bumped on each import so the node list replays its entrance.
  const [revision, setRevision] = useState(0)
  const [adding, setAdding] = useState(false)
  const [clearing, setClearing] = useState(false)
  const [traffic, setTraffic] = useState({ up: 0, down: 0 })
  const [now, setNow] = useState(() => Date.now())
  const [page, setPage] = useState(0)
  const pageRef = useRef(0)
  const fileInputRef = useRef<HTMLInputElement>(null)
  const pagerRef = useRef<HTMLElement>(null)
  const connected =
    state.status === 'connected' || state.status === 'reasserting'
  const transition =
    state.status === 'connecting' || state.status === 'disconnecting'
  const locked = busy || connected || transition
  const statusLabel = busy ? '请稍候' : statusText[state.status] || '未连接'
  const sources = profile?.sources ?? []
  const nodes = groups.flatMap((group) => group.nodes)

  useEffect(() => {
    if (!connected) return
    let active = true
    const poll = async () => {
      const next = await callNative<{ up?: number; down?: number }>(
        'getTraffic',
      ).catch(() => ({}) as { up?: number; down?: number })
      if (!active) return
      setTraffic({ up: next.up ?? 0, down: next.down ?? 0 })
      setNow(Date.now())
    }
    void poll()
    const timer = window.setInterval(poll, 1000)
    return () => {
      active = false
      window.clearInterval(timer)
    }
  }, [connected])

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
      .then(async (next) => {
        if (!active) return
        setState(next)
        const rules = normalizeRouting(next.routing)
        setRouting(rules)
        setRoutingData(next.routingData)
        const saved = normalizeProfile(next.profile)
        if (!saved) return
        const items = groupNodes(saved.sources)
        const all = items.flatMap((group) => group.nodes)
        const node = all.some((item) => item.name === saved.selectedNode)
          ? (saved.selectedNode as string)
          : all[0].name
        setProfile(saved)
        setGroups(items)
        setSelected(node)
        // An update can change the default routing; the tunnel's file follows the saved state.
        if (next.status === 'connecting' || next.status === 'disconnecting')
          return
        setBusy(true)
        try {
          await callNative('applyConfiguration', {
            configuration: runtimeConfig(all, node, {
              rules: rules.rules,
              chinaLists: Boolean(next.routingData),
            }),
          })
        } finally {
          setBusy(false)
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

  // WebKit keeps the old offset when the width changes, such as on rotation, instead of snapping again.
  useEffect(() => {
    const pager = pagerRef.current
    if (!pager) return
    const observer = new ResizeObserver(() => {
      pager.scrollLeft = pageRef.current * pager.clientWidth
    })
    observer.observe(pager)
    return () => observer.disconnect()
  }, [])

  // The keyboard covers the full-height page; sheets rise with it in CSS, and a field on a page is
  // scrolled above it here, as the keyboard starts to move.
  useEffect(() => {
    let covered = 0
    window.onedayKeyboard = (height, duration) => {
      const root = document.documentElement.style
      root.setProperty('--keyboard-duration', `${duration}ms`)
      // Pages give their extra room back with the keyboard, so a page scrolled into it settles with it.
      root.setProperty(
        '--keyboard-closing',
        `${height < covered ? duration : 0}ms`,
      )
      root.setProperty('--keyboard', `${height}px`)
      covered = height
      const field = document.activeElement
      if (!height || !(field instanceof HTMLInputElement)) return
      const page = field.closest('.page')
      if (!page) return
      const over =
        (field.closest('.card') ?? field).getBoundingClientRect().bottom -
        (page.getBoundingClientRect().bottom - height)
      if (over > 0) page.scrollBy({ top: over, behavior: motion() })
    }
    return () => {
      window.onedayKeyboard = undefined
    }
  }, [])

  async function commit(next: Source[], prefer = selected, imported = true) {
    if (next.length === 0) {
      await callNative('deleteProfile')
      setProfile(undefined)
      setGroups([])
      setSelected('')
    } else {
      const items = groupNodes(next)
      const all = items.flatMap((group) => group.nodes)
      const selectedNode = all.some((node) => node.name === prefer)
        ? prefer
        : all[0].name
      const saved: Profile = { sources: next, selectedNode }
      await callNative('saveProfile', { profile: saved })
      setProfile(saved)
      setGroups(items)
      setSelected(selectedNode)
    }
    if (imported) {
      setURL('')
      setAdding(false)
      setRevision((value) => value + 1)
    }
  }

  // A running tunnel keeps the node it started with, so the file it reloads names that node too.
  // Saving holds `busy` so connecting cannot write the tunnel's file with the old rules meanwhile.
  async function saveRules(rules: CustomRule[]) {
    const node = nodes.some((item) => item.name === profile?.selectedNode)
      ? (profile?.selectedNode as string)
      : selected
    setBusy(true)
    try {
      await callNative('saveRouting', {
        routing: { rules },
        ...(profile
          ? {
              configuration: runtimeConfig(nodes, node, {
                rules,
                chinaLists: Boolean(routingData),
              }),
            }
          : {}),
      })
      setRouting({ rules })
    } finally {
      setBusy(false)
    }
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
        const { nodes: added, skipped } = parseShareLinks(input)
        const current = sources.find((source) => source.kind === 'standalone')
        const standalone: Source = {
          id: 'standalone',
          kind: 'standalone',
          name: standaloneName,
          yaml: nodesToYaml(
            mergeLinks(current ? parseNodes(current.yaml) : [], added),
          ),
        }
        await commit(
          current
            ? sources.map((source) =>
                source === current ? standalone : source,
              )
            : [...sources, standalone],
          added[0].name,
        )
        if (skipped.length > 0)
          setError(`已跳过暂不支持的 ${skipped.join('、')} 链接。`)
        return
      }
      const { content } = await callNative<{ content: string }>(
        'fetchSubscription',
        { url: input },
      )
      const current = sources.find((source) => source.url === input)
      const count = sources.filter((source) => source.kind === 'subscription')
      await commit(
        current
          ? sources.map((source) =>
              source === current ? { ...source, yaml: content } : source,
            )
          : [
              ...sources,
              {
                id: `subscription-${Date.now()}`,
                kind: 'subscription',
                name: count.length ? `订阅 ${count.length + 1}` : '我的订阅',
                url: input,
                yaml: content,
              },
            ],
      )
    })
  }

  function remove(task: () => Promise<void>) {
    if (connected || transition) {
      setError('断开连接后才能删除节点。')
      return
    }
    void action(task)
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
      const saved = { ...profile, selectedNode: selected }
      await callNative('saveProfile', { profile: saved })
      setProfile(saved)
      await callNative('connect', {
        configuration: runtimeConfig(nodes, selected, {
          rules: routing.rules,
          chinaLists: Boolean(routingData),
        }),
        nodeName: selected,
      })
      setState((current) => ({ ...current, status: 'connecting' }))
    })
    setToggling(false)
  }

  function turn(index: number) {
    const pager = pagerRef.current
    pager?.scrollTo({ left: index * pager.clientWidth, behavior: motion() })
  }

  // Each page carries the banner so an error is seen on the page that raised it.
  function banner(index: number) {
    return (
      error && (
        <div
          className="error"
          role={page === index ? 'alert' : undefined}
          inert={page !== index}
        >
          {error}
          <button onClick={() => setError('')} aria-label="关闭提示">
            ×
          </button>
        </div>
      )
    )
  }

  function addForm() {
    return (
      <>
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
            disabled={locked}
          />
          <button className="import-button" disabled={locked || !url.trim()}>
            导入
          </button>
        </form>
        <button
          className="text-button file-button"
          disabled={locked}
          onClick={() => fileInputRef.current?.click()}
        >
          或从文件导入 ↗
        </button>
      </>
    )
  }

  return (
    <>
      <main
        ref={pagerRef}
        className="pager"
        onScroll={(event) => {
          const pager = event.currentTarget
          pageRef.current = Math.round(
            pager.scrollLeft / Math.max(1, pager.clientWidth),
          )
          setPage(pageRef.current)
        }}
      >
        <section className="page" aria-label={pages[0]}>
          <div className="page-body">
            <header>
              <div className="wordmark">
                <span className="sun" aria-hidden="true" />
                有朝<span className="roman">Oneday</span>
              </div>
            </header>
            <section className="connection">
              <Verse />
              <Power
                connected={connected}
                pending={toggling || transition}
                disabled={busy || transition || (!profile && !connected)}
                rate={traffic.up + traffic.down}
                label={connected ? '断开连接' : '连接 VPN'}
                onToggle={toggle}
              />
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
              {connected && (
                <>
                  <p className="speed">
                    <span>
                      <span className="speed-arrow">↓</span>{' '}
                      {formatRate(traffic.down)}
                    </span>
                    <span>
                      <span className="speed-arrow">↑</span>{' '}
                      {formatRate(traffic.up)}
                    </span>
                  </p>
                  <p className="route-label">
                    {routingData ? '智能分流' : '全部代理'} · {selected}
                    {state.connectedAt
                      ? ` · ${formatDuration(now - state.connectedAt)}`
                      : ''}
                  </p>
                </>
              )}
            </section>

            {banner(0)}

            {groups.length === 0 ? (
              <section className="card">
                <div className="section-title">
                  <h2>添加节点</h2>
                </div>
                <p className="muted">
                  添加 Clash / Mihomo 订阅，或粘贴 vless:// 与 hysteria2://
                  节点链接。
                </p>
                {!adding && addForm()}
              </section>
            ) : (
              <section
                key={revision}
                className={revision ? 'card nodes fresh' : 'card nodes'}
              >
                <div className="section-title">
                  <h2>选择节点</h2>
                  <span className="section-actions">
                    <span className="muted">{nodes.length}</span>
                    <button
                      className="add-button"
                      aria-label="添加节点"
                      disabled={locked}
                      onClick={() => setAdding(true)}
                    >
                      <svg viewBox="0 0 24 24" aria-hidden="true">
                        <path d="M12 5v14M5 12h14" />
                      </svg>
                    </button>
                  </span>
                </div>
                {groups.map(({ source, nodes: members }) => (
                  <div key={source.id} className="group">
                    <SwipeRow
                      label={
                        source.kind === 'subscription' ? '删除订阅' : '全部删除'
                      }
                      locked={connected || transition}
                      onDelete={() =>
                        remove(() =>
                          commit(
                            sources.filter((item) => item !== source),
                            selected,
                            false,
                          ),
                        )
                      }
                    >
                      <div className="group-head">
                        <span>{groupTitle(source)}</span>
                        <span>
                          {members.length}
                          {source.url && (
                            <button
                              className="text-button"
                              disabled={locked}
                              onClick={() =>
                                source.url && importInput(source.url)
                              }
                            >
                              更新
                            </button>
                          )}
                        </span>
                      </div>
                    </SwipeRow>
                    {members.map((node, index) => {
                      const row = (
                        <button
                          className={`node ${selected === node.name ? 'selected' : ''}`}
                          style={{ '--i': Math.min(index, 8) } as CSSProperties}
                          disabled={locked}
                          onClick={() => setSelected(node.name)}
                        >
                          <span className="node-symbol">
                            {node.type === 'hysteria2' ? '≈' : '↗'}
                          </span>
                          <span className="node-info">
                            <strong>{node.name}</strong>
                            <small>{protocolLabel(node)}</small>
                          </span>
                          <span className="radio" />
                        </button>
                      )
                      return source.kind === 'standalone' ? (
                        <SwipeRow
                          key={node.name}
                          label="删除"
                          locked={connected || transition}
                          onDelete={() =>
                            remove(() => {
                              const remaining = parseNodes(source.yaml).filter(
                                (_, position) => position !== index,
                              )
                              return commit(
                                remaining.length
                                  ? sources.map((item) =>
                                      item === source
                                        ? {
                                            ...item,
                                            yaml: nodesToYaml(remaining),
                                          }
                                        : item,
                                    )
                                  : sources.filter((item) => item !== source),
                                selected,
                                false,
                              )
                            })
                          }
                        >
                          {row}
                        </SwipeRow>
                      ) : (
                        <Fragment key={node.name}>{row}</Fragment>
                      )
                    })}
                  </div>
                ))}
              </section>
            )}

            {groups.length > 0 && (
              <div className="clear-all">
                {clearing ? (
                  <p className="clear-confirm">
                    清除所有订阅和独立节点？
                    <button
                      className="text-button"
                      onClick={() => setClearing(false)}
                    >
                      取消
                    </button>
                    <button
                      className="danger-button"
                      onClick={() => {
                        setClearing(false)
                        remove(() => commit([], '', false))
                      }}
                    >
                      清除
                    </button>
                  </p>
                ) : (
                  <button
                    className="text-button danger-text"
                    onClick={() =>
                      connected || transition
                        ? setError('断开连接后才能删除节点。')
                        : setClearing(true)
                    }
                  >
                    清除全部节点
                  </button>
                )}
              </div>
            )}

            <footer>
              <strong>有朝 · Oneday · いつか</strong>
            </footer>
          </div>
        </section>
        <section className="page" aria-label={pages[1]}>
          <div className="page-body">
            <Rules
              rules={routing.rules}
              routingData={routingData}
              onSave={saveRules}
              onError={setError}
              locked={busy || transition}
              banner={banner(1)}
            />
          </div>
        </section>
      </main>

      <nav className="pager-dots" aria-label="页面">
        {pages.map((label, index) => (
          <button
            key={label}
            aria-label={label}
            aria-current={page === index ? 'page' : undefined}
            onClick={() => turn(index)}
          />
        ))}
      </nav>

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
              const yaml = await file.text()
              await commit([
                ...sources,
                {
                  id: `file-${Date.now()}`,
                  kind: 'file',
                  name: file.name,
                  yaml,
                },
              ])
            })
          event.target.value = ''
        }}
      />

      {adding && (
        <div
          className="sheet-layer"
          onClick={(event) => {
            if (event.target === event.currentTarget) setAdding(false)
          }}
        >
          <section className="sheet" role="dialog" aria-label="添加节点">
            <span className="sheet-handle" aria-hidden="true" />
            <h2>添加节点</h2>
            <p className="muted">订阅会单独成组，节点链接加入「独立节点」。</p>
            {addForm()}
          </section>
        </div>
      )}
    </>
  )
}
