import { useState } from 'react'
import { AnimatePresence, motion } from 'framer-motion'
import * as Icons from 'lucide-react'
import { GripVertical, Pencil, Plus, Trash2, Waypoints, X } from 'lucide-react'
import { PRESETS, type RoutingPreset } from '@shared/presets'
import { RULE_SETS } from '@shared/rulesets'
import type { Matcher, MatcherKind, RoutingRule, RuleAction } from '@shared/types'
import { uid } from '@shared/parsers'
import { useStore } from '../store'
import { ActionSeg, Empty, Modal, Switch, spring } from '../ui'

const GROUP_TITLES: Record<RoutingPreset['group'], string> = {
  fix: 'Исправления',
  force: 'Через VPN',
  bypass: 'Мимо VPN',
  block: 'Блокировка'
}

const MATCHER_LABELS: Record<MatcherKind, string> = {
  process: 'Программа (.exe)',
  process_path: 'Полный путь к программе',
  domain: 'Домен точно',
  domain_suffix: 'Домен и поддомены',
  domain_keyword: 'Домен содержит',
  domain_regex: 'Домен по регулярке',
  ip_cidr: 'IP-адрес или подсеть',
  port: 'Порт',
  port_range: 'Диапазон портов',
  ruleset: 'Готовый список',
  network: 'Протокол TCP/UDP',
  protocol: 'Тип трафика'
}

const MATCHER_HINTS: Partial<Record<MatcherKind, string>> = {
  process: 'Discord.exe, chrome.exe',
  domain_suffix: 'example.com',
  domain_keyword: 'youtube',
  ip_cidr: '1.2.3.0/24',
  port: '443',
  port_range: '50000:65535',
  network: 'tcp или udp',
  protocol: 'quic, bittorrent, tls, http, dns, stun'
}

export default function Routing(): JSX.Element {
  const { snap, setPresets, setCustomRules } = useStore()
  const [editing, setEditing] = useState<RoutingRule | null>(null)
  const [dragIdx, setDragIdx] = useState<number | null>(null)

  const toggle = (id: string): void => {
    const on = snap.enabledPresets.includes(id)
    void setPresets(on ? snap.enabledPresets.filter((x) => x !== id) : [...snap.enabledPresets, id])
  }

  const groups = (['fix', 'force', 'bypass', 'block'] as const).map((g) => ({
    g,
    items: PRESETS.filter((p) => p.group === g)
  }))

  const rules = snap.customRules

  const move = (from: number, to: number): void => {
    if (from === to || to < 0 || to >= rules.length) return
    const next = [...rules]
    const [item] = next.splice(from, 1)
    next.splice(to, 0, item)
    void setCustomRules(next)
  }

  return (
    <>
      <div className="page-head">
        <h1>Маршруты</h1>
        <p>
          Правила проверяются сверху вниз, срабатывает первое подходящее. Сначала — ваши правила из списка ниже,
          затем пресеты, затем режим маршрутизации с главной страницы.
        </p>
      </div>

      {groups.map(({ g, items }) => (
        <div key={g}>
          <div className="section-title">{GROUP_TITLES[g]}</div>
          <div className="preset-grid">
            {items.map((p) => {
              const on = snap.enabledPresets.includes(p.id)
              const Icon = (Icons as unknown as Record<string, typeof Waypoints>)[p.icon] ?? Waypoints
              return (
                <button key={p.id} className={`preset${on ? ' on' : ''}`} onClick={() => toggle(p.id)}>
                  <div className="top">
                    <span className="ico">
                      <Icon size={16} />
                    </span>
                    <b>{p.name}</b>
                    <Switch on={on} onChange={() => toggle(p.id)} />
                  </div>
                  <p>{p.description}</p>
                </button>
              )
            })}
          </div>
        </div>
      ))}

      <div className="section-title" style={{ display: 'flex', alignItems: 'center', gap: 12 }}>
        <span>Свои правила</span>
        <button className="btn sm" onClick={() => setEditing(blankRule())} style={{ marginLeft: 'auto' }}>
          <Plus size={14} />
          Добавить правило
        </button>
      </div>

      {!rules.length ? (
        <div className="card">
          <Empty
            icon={<Waypoints size={36} strokeWidth={1.4} />}
            title="Своих правил пока нет"
            text="Правило позволяет отправить конкретные домены, адреса, порты или программы в туннель, мимо него или вовсе заблокировать."
            action={
              <button className="btn primary" onClick={() => setEditing(blankRule())}>
                <Plus size={15} />
                Создать правило
              </button>
            }
          />
        </div>
      ) : (
        <div className="list">
          <AnimatePresence initial={false}>
            {rules.map((r, i) => (
              <motion.div
                key={r.id}
                layout
                initial={{ opacity: 0, y: 6 }}
                animate={{ opacity: 1, y: 0 }}
                exit={{ opacity: 0, height: 0, marginBottom: -8 }}
                transition={spring}
                className={`rule${dragIdx === i ? ' dragging' : ''}`}
                draggable
                onDragStart={() => setDragIdx(i)}
                onDragEnd={() => setDragIdx(null)}
                onDragOver={(e) => {
                  e.preventDefault()
                  if (dragIdx !== null && dragIdx !== i) {
                    move(dragIdx, i)
                    setDragIdx(i)
                  }
                }}
              >
                <span className="grab">
                  <GripVertical size={15} />
                </span>
                <Switch
                  on={r.enabled}
                  onChange={(v) => setCustomRules(rules.map((x) => (x.id === r.id ? { ...x, enabled: v } : x)))}
                />
                <div className="grow col" style={{ minWidth: 0 }}>
                  <b style={{ fontSize: 13.5 }}>{r.name || 'Без названия'}</b>
                  <span className="dim ell" style={{ fontSize: 11.5 }}>
                    {describe(r)}
                  </span>
                </div>
                <ActionSeg
                  value={r.action}
                  onChange={(a) => setCustomRules(rules.map((x) => (x.id === r.id ? { ...x, action: a } : x)))}
                />
                <button className="btn icon sm ghost" onClick={() => setEditing(r)} title="Изменить">
                  <Pencil size={14} />
                </button>
                <button
                  className="btn icon sm ghost"
                  onClick={() => setCustomRules(rules.filter((x) => x.id !== r.id))}
                  title="Удалить"
                >
                  <Trash2 size={14} />
                </button>
              </motion.div>
            ))}
          </AnimatePresence>
        </div>
      )}

      <RuleEditor
        rule={editing}
        onClose={() => setEditing(null)}
        onSave={(r) => {
          const exists = rules.some((x) => x.id === r.id)
          void setCustomRules(exists ? rules.map((x) => (x.id === r.id ? r : x)) : [...rules, r])
          setEditing(null)
        }}
      />
    </>
  )
}

function blankRule(): RoutingRule {
  return {
    id: uid(),
    name: '',
    enabled: true,
    action: 'proxy',
    matchers: [{ kind: 'domain_suffix', values: [] }]
  }
}

function describe(r: RoutingRule): string {
  const parts = r.matchers
    .filter((m) => m.values.length)
    .map((m) => {
      const label = MATCHER_LABELS[m.kind]
      const vals = m.kind === 'ruleset' ? m.values.map(prettyRuleSet) : m.values
      const head = vals.slice(0, 3).join(', ')
      return `${label}: ${head}${vals.length > 3 ? ` и ещё ${vals.length - 3}` : ''}`
    })
  return parts.join(' · ') || 'условия не заданы'
}

function prettyRuleSet(tag: string): string {
  return RULE_SETS.find((r) => r.tag === tag)?.label ?? tag
}

/* ─────────────── редактор правила ─────────────── */

function RuleEditor({
  rule,
  onClose,
  onSave
}: {
  rule: RoutingRule | null
  onClose: () => void
  onSave: (r: RoutingRule) => void
}): JSX.Element {
  const [draft, setDraft] = useState<RoutingRule | null>(rule)

  // Пересоздаём черновик при открытии другого правила
  if (rule && (!draft || draft.id !== rule.id)) setDraft(structuredClone(rule))
  if (!rule && draft) setDraft(null)
  if (!draft) return <Modal open={false} onClose={onClose} title="" children={null} />

  const setM = (i: number, m: Matcher): void =>
    setDraft({ ...draft, matchers: draft.matchers.map((x, j) => (j === i ? m : x)) })

  return (
    <Modal
      open={!!rule}
      onClose={onClose}
      wide
      title={rule && rule.name ? 'Изменить правило' : 'Новое правило'}
      icon={<Waypoints size={17} className="mut" />}
      footer={
        <>
          <button className="btn" onClick={onClose}>
            Отмена
          </button>
          <button
            className="btn primary"
            onClick={() =>
              onSave({
                ...draft,
                name: draft.name.trim() || 'Правило',
                matchers: draft.matchers.filter((m) => m.values.length)
              })
            }
            disabled={!draft.matchers.some((m) => m.values.length)}
          >
            Сохранить
          </button>
        </>
      }
    >
      <div className="row" style={{ gap: 12 }}>
        <div className="col grow" style={{ gap: 6 }}>
          <label className="dim" style={{ fontSize: 12 }}>
            Название
          </label>
          <input
            className="input"
            placeholder="Например: рабочие сервисы"
            value={draft.name}
            onChange={(e) => setDraft({ ...draft, name: e.target.value })}
          />
        </div>
        <div className="col" style={{ gap: 6 }}>
          <label className="dim" style={{ fontSize: 12 }}>
            Действие
          </label>
          <ActionSeg value={draft.action} onChange={(a: RuleAction) => setDraft({ ...draft, action: a })} />
        </div>
      </div>

      <div className="divider" style={{ margin: '4px 0' }} />

      <div className="col" style={{ gap: 10 }}>
        {draft.matchers.map((m, i) => (
          <div key={i} className="card pad" style={{ padding: 13 }}>
            <div className="row" style={{ marginBottom: 9 }}>
              <select
                className="select"
                style={{ width: 220 }}
                value={m.kind}
                onChange={(e) => setM(i, { kind: e.target.value as MatcherKind, values: [] })}
              >
                {(Object.keys(MATCHER_LABELS) as MatcherKind[]).map((k) => (
                  <option key={k} value={k}>
                    {MATCHER_LABELS[k]}
                  </option>
                ))}
              </select>
              <div className="grow" />
              <button
                className="btn icon sm ghost"
                onClick={() => setDraft({ ...draft, matchers: draft.matchers.filter((_, j) => j !== i) })}
              >
                <X size={14} />
              </button>
            </div>

            {m.kind === 'ruleset' ? (
              <RuleSetPicker values={m.values} onChange={(v) => setM(i, { ...m, values: v })} />
            ) : (
              <textarea
                className="input"
                style={{ minHeight: 66 }}
                placeholder={MATCHER_HINTS[m.kind] ?? 'по одному значению в строке'}
                value={m.values.join('\n')}
                onChange={(e) =>
                  setM(i, { ...m, values: e.target.value.split(/[\n,;]+/).map((s) => s.trim()).filter(Boolean) })
                }
                spellCheck={false}
              />
            )}
          </div>
        ))}
      </div>

      <button
        className="btn"
        onClick={() => setDraft({ ...draft, matchers: [...draft.matchers, { kind: 'domain_suffix', values: [] }] })}
      >
        <Plus size={15} />
        Добавить условие
      </button>
      <p className="dim" style={{ fontSize: 12 }}>
        Несколько условий в одном правиле работают как «И» между разными типами и как «ИЛИ» внутри одного типа.
      </p>
    </Modal>
  )
}

function RuleSetPicker({ values, onChange }: { values: string[]; onChange: (v: string[]) => void }): JSX.Element {
  const [q, setQ] = useState('')
  const list = RULE_SETS.filter((r) => r.label.toLowerCase().includes(q.toLowerCase()))
  return (
    <div className="col" style={{ gap: 8 }}>
      <input className="input" placeholder="Поиск списка" value={q} onChange={(e) => setQ(e.target.value)} />
      <div
        className="row wrap"
        style={{ gap: 6, maxHeight: 190, overflowY: 'auto', alignContent: 'flex-start', padding: 2 }}
      >
        {list.map((r) => {
          const on = values.includes(r.tag)
          return (
            <button
              key={r.tag}
              className={`chip${on ? ' acc' : ''}`}
              style={{ cursor: 'pointer' }}
              onClick={() => onChange(on ? values.filter((v) => v !== r.tag) : [...values, r.tag])}
            >
              {r.label}
            </button>
          )
        })}
      </div>
    </div>
  )
}
