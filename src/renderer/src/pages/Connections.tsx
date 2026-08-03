import { useMemo, useState } from 'react'
import { Network, Search, XCircle } from 'lucide-react'
import { bytes, duration, useStore } from '../store'
import { Empty } from '../ui'

type Filter = 'all' | 'proxy' | 'direct'

export default function Connections(): JSX.Element {
  const { connections, core, snap } = useStore()
  const [q, setQ] = useState('')
  const [filter, setFilter] = useState<Filter>('all')

  const rows = useMemo(() => {
    const s = q.trim().toLowerCase()
    return connections
      .filter((c) => {
        if (filter === 'direct' && c.outbound !== 'direct') return false
        if (filter === 'proxy' && c.outbound === 'direct') return false
        if (!s) return true
        return (
          c.host.toLowerCase().includes(s) ||
          c.process.toLowerCase().includes(s) ||
          c.ip.includes(s) ||
          c.rule.toLowerCase().includes(s)
        )
      })
      .sort((a, b) => b.download + b.upload - (a.download + a.upload))
  }, [connections, q, filter])

  const proxied = connections.filter((c) => c.outbound !== 'direct').length

  if (core.status !== 'running') {
    return (
      <>
        <Head />
        <div className="card">
          <Empty
            icon={<Network size={40} strokeWidth={1.4} />}
            title="Соединений нет"
            text="Список активных соединений появится, когда подключение будет установлено."
          />
        </div>
      </>
    )
  }

  return (
    <>
      <Head />

      <div className="row wrap" style={{ marginBottom: 14, gap: 9 }}>
        <div className="search-box">
          <Search size={15} />
          <input
            className="input"
            placeholder="Поиск по узлу, программе или правилу"
            value={q}
            onChange={(e) => setQ(e.target.value)}
          />
        </div>
        <div className="seg">
          {(
            [
              ['all', `Все · ${connections.length}`],
              ['proxy', `Через VPN · ${proxied}`],
              ['direct', `Напрямую · ${connections.length - proxied}`]
            ] as const
          ).map(([id, label]) => (
            <button key={id} className={filter === id ? 'active' : ''} onClick={() => setFilter(id)}>
              {filter === id && <span className="pill" />}
              {label}
            </button>
          ))}
        </div>
        <div className="grow" />
        <button className="btn danger" onClick={() => window.prism.core.closeAllConnections()}>
          <XCircle size={15} />
          Разорвать все
        </button>
      </div>

      <div className="card" style={{ overflow: 'hidden' }}>
        <div style={{ maxHeight: 'calc(100vh - 290px)', overflowY: 'auto', overflowX: 'auto' }}>
          <table className="table" style={{ minWidth: 780 }}>
            <thead>
              <tr>
                <th style={{ width: 150 }}>Программа</th>
                <th>Назначение</th>
                <th style={{ width: 58 }}>Прот.</th>
                <th style={{ width: 150 }}>Маршрут</th>
                <th style={{ width: 92, textAlign: 'right' }}>Принято</th>
                <th style={{ width: 92, textAlign: 'right' }}>Отдано</th>
                <th style={{ width: 66, textAlign: 'right' }}>Время</th>
                <th style={{ width: 34 }} />
              </tr>
            </thead>
            <tbody>
              {rows.map((c) => {
                const direct = c.outbound === 'direct'
                return (
                  <tr key={c.id}>
                    <td className="ell" style={{ maxWidth: 150 }} title={c.processPath}>
                      {c.process || <span className="dim">—</span>}
                    </td>
                    <td className="ell mono" style={{ maxWidth: 260, fontSize: 11.5 }}>
                      {c.host || c.ip}
                      <span className="dim">:{c.port}</span>
                    </td>
                    <td className="dim" style={{ textTransform: 'uppercase', fontSize: 11 }}>
                      {c.network}
                    </td>
                    <td>
                      <span className={`chip ${direct ? 'ok' : 'acc'}`} title={c.rule}>
                        {direct ? 'напрямую' : c.outbound || 'VPN'}
                      </span>
                    </td>
                    <td className="tnum" style={{ textAlign: 'right' }}>
                      {bytes(c.download)}
                    </td>
                    <td className="tnum" style={{ textAlign: 'right' }}>
                      {bytes(c.upload)}
                    </td>
                    <td className="tnum dim" style={{ textAlign: 'right' }}>
                      {duration(Date.now() - c.start)}
                    </td>
                    <td>
                      <button
                        className="btn icon sm ghost"
                        title="Разорвать"
                        onClick={() => window.prism.core.closeConnection(c.id)}
                      >
                        <XCircle size={13} />
                      </button>
                    </td>
                  </tr>
                )
              })}
              {!rows.length && (
                <tr>
                  <td colSpan={8} className="mut" style={{ textAlign: 'center', padding: 34 }}>
                    {connections.length ? 'Ничего не найдено' : 'Активных соединений нет'}
                  </td>
                </tr>
              )}
            </tbody>
          </table>
        </div>
      </div>

      <p className="dim" style={{ fontSize: 12, marginTop: 10 }}>
        Здесь видно, какая программа куда пошла и по какому правилу. Если приложение, которое должно идти через
        VPN, помечено как «напрямую» — добавьте его на вкладке «Приложения»
        {snap.settings.captureMode === 'proxy' ? ' или переключитесь в режим TUN' : ''}.
      </p>
    </>
  )
}

function Head(): JSX.Element {
  return (
    <div className="page-head">
      <h1>Соединения</h1>
      <p>Живой список того, что происходит прямо сейчас — с программой, адресом и сработавшим маршрутом.</p>
    </div>
  )
}
