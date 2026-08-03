import { useEffect, useMemo, useRef, useState } from 'react'
import { ArrowDownToLine, Copy, Pause, Play, Search, Trash2 } from 'lucide-react'
import { timeOf, useStore } from '../store'

const LEVELS = ['all', 'info', 'warn', 'error'] as const
type Level = (typeof LEVELS)[number]

const LEVEL_LABEL: Record<Level, string> = {
  all: 'Все',
  info: 'Инфо',
  warn: 'Предупреждения',
  error: 'Ошибки'
}

export default function Logs(): JSX.Element {
  const { logs, clearLogs, logPaused, setLogPaused, toast } = useStore()
  const [level, setLevel] = useState<Level>('all')
  const [q, setQ] = useState('')
  const [stick, setStick] = useState(true)
  const boxRef = useRef<HTMLDivElement>(null)

  const rows = useMemo(() => {
    const s = q.trim().toLowerCase()
    return logs.filter((l) => {
      const lv = l.level.toLowerCase()
      if (level === 'error' && !/error|fatal|panic/.test(lv)) return false
      if (level === 'warn' && !/warn|error|fatal|panic/.test(lv)) return false
      if (level === 'info' && /debug|trace/.test(lv)) return false
      return !s || l.message.toLowerCase().includes(s)
    })
  }, [logs, level, q])

  useEffect(() => {
    if (stick && boxRef.current) boxRef.current.scrollTop = boxRef.current.scrollHeight
  }, [rows.length, stick])

  const copyAll = async (): Promise<void> => {
    await window.prism.system.clipboardWrite(
      rows.map((l) => `${timeOf(l.t)} [${l.level}] ${l.message}`).join('\n')
    )
    toast('ok', 'Журнал скопирован в буфер обмена')
  }

  return (
    <>
      <div className="page-head">
        <h1>Журнал</h1>
        <p>Сообщения ядра и приложения. Если что-то не подключается — ответ почти всегда здесь.</p>
      </div>

      <div className="row wrap" style={{ marginBottom: 12, gap: 9 }}>
        <div className="search-box">
          <Search size={15} />
          <input
            className="input"
            placeholder="Поиск по тексту"
            value={q}
            onChange={(e) => setQ(e.target.value)}
          />
        </div>
        <div className="seg">
          {LEVELS.map((l) => (
            <button key={l} className={level === l ? 'active' : ''} onClick={() => setLevel(l)}>
              {level === l && <span className="pill" />}
              {LEVEL_LABEL[l]}
            </button>
          ))}
        </div>
        <div className="grow" />
        <button className={`btn${stick ? ' primary' : ''}`} onClick={() => setStick(!stick)} title="Прокручивать к новым">
          <ArrowDownToLine size={15} />
        </button>
        <button className="btn" onClick={() => setLogPaused(!logPaused)}>
          {logPaused ? <Play size={15} /> : <Pause size={15} />}
          {logPaused ? 'Продолжить' : 'Пауза'}
        </button>
        <button className="btn" onClick={copyAll} disabled={!rows.length}>
          <Copy size={15} />
        </button>
        <button className="btn" onClick={clearLogs} disabled={!logs.length}>
          <Trash2 size={15} />
        </button>
      </div>

      <div className="card" style={{ height: 'calc(100vh - 250px)', overflow: 'hidden' }}>
        <div
          className="logs"
          ref={boxRef}
          onScroll={(e) => {
            const el = e.currentTarget
            const atBottom = el.scrollHeight - el.scrollTop - el.clientHeight < 40
            if (atBottom !== stick) setStick(atBottom)
          }}
        >
          {!rows.length ? (
            <div className="mut" style={{ padding: 26, textAlign: 'center', fontFamily: 'var(--font)' }}>
              {logs.length ? 'Под фильтр ничего не попало' : 'Пока пусто — записи появятся при подключении'}
            </div>
          ) : (
            rows.map((l) => (
              <div key={l.id} className={`logline ${l.level.toLowerCase()}`}>
                <span className="t">{timeOf(l.t)}</span>
                <span className="l">{l.level.toUpperCase().slice(0, 5)}</span>
                <span className="m">{l.message}</span>
              </div>
            ))
          )}
        </div>
      </div>

      <div className="row dim" style={{ fontSize: 12, marginTop: 8 }}>
        <span>
          Показано {rows.length} из {logs.length}
        </span>
        {logPaused && <span className="chip warn">приём на паузе</span>}
      </div>
    </>
  )
}
