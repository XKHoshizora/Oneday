import { type FormEvent, type ReactNode, useState } from 'react'
import { createPortal } from 'react-dom'

import {
  type CustomRule,
  maxRules,
  parseRuleValue,
  type RuleAction,
  type RuleKind,
  sortRules,
} from './routing'
import { SwipeRow } from './SwipeRow'

const kinds: {
  kind: RuleKind
  label: string
  placeholder: string
  hint: string
}[] = [
  {
    kind: 'suffix',
    label: '域名后缀',
    placeholder: 'example.com',
    hint: '匹配该域名及其所有子域名：example.com 包含 www.example.com，但不包含 badexample.com。',
  },
  {
    kind: 'domain',
    label: '完整域名',
    placeholder: 'www.example.com',
    hint: '只匹配这一个域名，不含它的子域名。',
  },
  {
    kind: 'ip',
    label: 'IP 段',
    placeholder: '192.168.1.0/24 或 2001:db8::/32',
    hint: '支持 IPv4 与 IPv6。单个地址按 /32 或 /128 处理；访问域名时按解析出的地址判断。',
  },
]

const actions: { action: RuleAction; label: string }[] = [
  { action: 'direct', label: '直连' },
  { action: 'proxy', label: '代理' },
]

function kindLabel(rule: CustomRule) {
  if (rule.kind === 'suffix') return '域名及子域名'
  if (rule.kind === 'domain') return '仅此域名'
  return rule.value.includes(':') ? 'IPv6 段' : 'IPv4 段'
}

type Draft = {
  id?: string
  kind: RuleKind
  value: string
  action: RuleAction
}

type RulesProps = {
  rules: CustomRule[]
  routingData?: string
  // Saving rejects with a message when the rules could not be stored or applied to the tunnel.
  onSave: (rules: CustomRule[]) => Promise<void>
  onError: (message: string) => void
  locked: boolean
  // Shown under the page title, where an error raised on this page can be seen.
  banner?: ReactNode
}

export function Rules({
  rules,
  routingData,
  onSave,
  onError,
  locked,
  banner,
}: RulesProps) {
  const [draft, setDraft] = useState<Draft | null>(null)
  const [problem, setProblem] = useState('')
  const [saving, setSaving] = useState(false)
  const busy = locked || saving

  function open(next: Draft) {
    setProblem('')
    setDraft(next)
  }

  async function save(next: CustomRule[]) {
    setSaving(true)
    try {
      await onSave(next)
      return true
    } catch (failure) {
      const message =
        failure instanceof Error ? failure.message : String(failure)
      if (draft) setProblem(message)
      else onError(message)
      return false
    } finally {
      setSaving(false)
    }
  }

  async function submit(event: FormEvent) {
    event.preventDefault()
    if (!draft) return
    let value: string
    try {
      value = parseRuleValue(draft.kind, draft.value)
    } catch (failure) {
      setProblem(failure instanceof Error ? failure.message : String(failure))
      return
    }
    if (
      rules.some(
        (rule) =>
          rule.id !== draft.id &&
          rule.kind === draft.kind &&
          rule.value === value,
      )
    ) {
      setProblem('已有相同的例外规则，可直接编辑它。')
      return
    }
    if (!draft.id && rules.length >= maxRules) {
      setProblem(`例外规则最多 ${maxRules} 条。`)
      return
    }
    const rule: CustomRule = {
      id: draft.id ?? `rule-${Date.now()}`,
      kind: draft.kind,
      value,
      action: draft.action,
      enabled: rules.find((item) => item.id === draft.id)?.enabled ?? true,
    }
    const next = draft.id
      ? rules.map((item) => (item.id === draft.id ? rule : item))
      : [...rules, rule]
    if (await save(next)) setDraft(null)
  }

  async function remove(id: string) {
    if (await save(rules.filter((rule) => rule.id !== id))) setDraft(null)
  }

  const current = kinds.find((item) => item.kind === draft?.kind) ?? kinds[0]

  return (
    <>
      <header>
        <h2 className="page-title">分流</h2>
        <button
          className="add-button"
          aria-label="添加例外规则"
          disabled={busy}
          onClick={() => open({ kind: 'suffix', value: '', action: 'direct' })}
        >
          <svg viewBox="0 0 24 24" aria-hidden="true">
            <path d="M12 5v14M5 12h14" />
          </svg>
        </button>
      </header>
      {banner}
      {routingData ? (
        <p className="rules-intro">
          中国大陆的网站和 IP 直连，局域网直连，其余经所选节点。
        </p>
      ) : (
        <p className="rules-intro rules-warning">
          分流数据不可用：除局域网和例外规则外，所有连接都经所选节点。
        </p>
      )}
      <section className="card rules">
        <div className="group-head">
          <span>例外 · 越具体越优先</span>
          <span>{rules.length}</span>
        </div>
        {rules.length === 0 ? (
          <p className="muted rules-empty">还没有例外。点右上角的 + 添加。</p>
        ) : (
          sortRules(rules).map((rule) => (
            <SwipeRow
              key={rule.id}
              label="删除"
              locked={busy}
              onDelete={() =>
                busy
                  ? onError('请等待当前操作完成后再删除规则。')
                  : void remove(rule.id)
              }
            >
              <div className={rule.enabled ? 'rule' : 'rule off'}>
                <button
                  className="rule-main"
                  disabled={busy}
                  onClick={() =>
                    open({
                      id: rule.id,
                      kind: rule.kind,
                      value: rule.value,
                      action: rule.action,
                    })
                  }
                >
                  <span className="rule-info">
                    <strong>{rule.value}</strong>
                    <small>{kindLabel(rule)}</small>
                  </span>
                  <span className={`rule-action ${rule.action}`}>
                    {rule.action === 'direct' ? '直连' : '代理'}
                  </span>
                </button>
                <button
                  className="switch"
                  role="switch"
                  aria-checked={rule.enabled}
                  aria-label={`启用 ${rule.value}`}
                  disabled={busy}
                  onClick={() =>
                    void save(
                      rules.map((item) =>
                        item.id === rule.id
                          ? { ...item, enabled: !item.enabled }
                          : item,
                      ),
                    )
                  }
                >
                  <span />
                </button>
              </div>
            </SwipeRow>
          ))
        )}
      </section>
      <p className="muted rules-note">
        例外优先于默认分流。连接时修改会立即生效，已打开的连接会重新建立。
        {routingData && `分流数据 ${routingData}。`}
      </p>

      {/* The sheet covers the whole screen, outside the horizontally scrolling pages. */}
      {draft &&
        createPortal(
          <div
            className="sheet-layer"
            onClick={(event) => {
              if (event.target === event.currentTarget && !saving)
                setDraft(null)
            }}
          >
            <section
              className="sheet"
              role="dialog"
              aria-label={draft.id ? '编辑例外' : '添加例外'}
            >
              <span className="sheet-handle" aria-hidden="true" />
              <h2>{draft.id ? '编辑例外' : '添加例外'}</h2>
              <form className="rule-form" onSubmit={submit}>
                <div
                  className="segmented"
                  role="radiogroup"
                  aria-label="匹配方式"
                >
                  {kinds.map((item) => (
                    <button
                      key={item.kind}
                      type="button"
                      role="radio"
                      aria-checked={draft.kind === item.kind}
                      onClick={() => {
                        setProblem('')
                        setDraft({ ...draft, kind: item.kind })
                      }}
                    >
                      {item.label}
                    </button>
                  ))}
                </div>
                <label className="sr-only" htmlFor="rule-value">
                  {current.label}
                </label>
                <input
                  id="rule-value"
                  type="text"
                  inputMode="url"
                  placeholder={current.placeholder}
                  value={draft.value}
                  onChange={(event) => {
                    setProblem('')
                    setDraft({ ...draft, value: event.target.value })
                  }}
                  autoCapitalize="none"
                  autoCorrect="off"
                  spellCheck={false}
                  aria-invalid={problem ? true : undefined}
                  aria-describedby="rule-hint"
                />
                <p id="rule-hint" className="muted rule-hint">
                  {current.hint}
                </p>
                <div
                  className="segmented"
                  role="radiogroup"
                  aria-label="连接方式"
                >
                  {actions.map((item) => (
                    <button
                      key={item.action}
                      type="button"
                      role="radio"
                      aria-checked={draft.action === item.action}
                      onClick={() =>
                        setDraft({ ...draft, action: item.action })
                      }
                    >
                      {item.label}
                    </button>
                  ))}
                </div>
                <p className="muted rule-hint">代理使用当前选中的节点。</p>
                {problem && (
                  <p className="field-error" role="alert">
                    {problem}
                  </p>
                )}
                <div className="sheet-actions">
                  {draft.id && (
                    <button
                      type="button"
                      className="text-button danger-text"
                      disabled={busy}
                      onClick={() => draft.id && void remove(draft.id)}
                    >
                      删除
                    </button>
                  )}
                  <button
                    className="import-button"
                    disabled={busy || !draft.value.trim()}
                  >
                    保存
                  </button>
                </div>
              </form>
            </section>
          </div>,
          document.body,
        )}
    </>
  )
}
