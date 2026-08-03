import { AnimatePresence, motion } from 'framer-motion'
import { X } from 'lucide-react'
import type { ReactNode } from 'react'
import { useEffect } from 'react'
import type { RuleAction } from '@shared/types'

export const spring = { type: 'spring' as const, stiffness: 420, damping: 34, mass: 0.7 }

export function Switch({
  on,
  onChange,
  disabled
}: {
  on: boolean
  onChange: (v: boolean) => void
  disabled?: boolean
}) {
  return (
    <button
      className={`switch${on ? ' on' : ''}`}
      disabled={disabled}
      onClick={() => onChange(!on)}
      role="switch"
      aria-checked={on}
    >
      <i />
    </button>
  )
}

export function Segmented<T extends string>({
  value,
  options,
  onChange,
  id
}: {
  value: T
  options: { value: T; label: string; icon?: ReactNode }[]
  onChange: (v: T) => void
  id: string
}) {
  return (
    <div className="seg">
      {options.map((o) => (
        <button key={o.value} className={value === o.value ? 'active' : ''} onClick={() => onChange(o.value)}>
          {value === o.value && (
            <motion.span className="pill" layoutId={`seg-${id}`} transition={spring} />
          )}
          {o.icon}
          {o.label}
        </button>
      ))}
    </div>
  )
}

export function ActionSeg({ value, onChange }: { value: RuleAction; onChange: (v: RuleAction) => void }) {
  const opts: { v: RuleAction; l: string }[] = [
    { v: 'proxy', l: 'VPN' },
    { v: 'direct', l: 'Напрямую' },
    { v: 'block', l: 'Блок' }
  ]
  return (
    <div className="act-seg">
      {opts.map((o) => (
        <button
          key={o.v}
          data-a={o.v}
          className={value === o.v ? 'on' : ''}
          onClick={(e) => {
            e.stopPropagation()
            onChange(o.v)
          }}
        >
          {o.l}
        </button>
      ))}
    </div>
  )
}

export function Setting({
  title,
  hint,
  children
}: {
  title: string
  hint?: ReactNode
  children: ReactNode
}) {
  return (
    <div className="setting">
      <div className="txt">
        <b>{title}</b>
        {hint && <span>{hint}</span>}
      </div>
      <div className="ctl">{children}</div>
    </div>
  )
}

export function Modal({
  open,
  onClose,
  title,
  icon,
  children,
  footer,
  wide
}: {
  open: boolean
  onClose: () => void
  title: string
  icon?: ReactNode
  children: ReactNode
  footer?: ReactNode
  wide?: boolean
}) {
  useEffect(() => {
    if (!open) return
    const h = (e: KeyboardEvent): void => {
      if (e.key === 'Escape') onClose()
    }
    window.addEventListener('keydown', h)
    return () => window.removeEventListener('keydown', h)
  }, [open, onClose])

  return (
    <AnimatePresence>
      {open && (
        <motion.div
          className="backdrop"
          initial={{ opacity: 0 }}
          animate={{ opacity: 1 }}
          exit={{ opacity: 0 }}
          transition={{ duration: 0.16 }}
          onMouseDown={(e) => e.target === e.currentTarget && onClose()}
        >
          <motion.div
            className={`modal${wide ? ' wide' : ''}`}
            initial={{ opacity: 0, scale: 0.96, y: 14 }}
            animate={{ opacity: 1, scale: 1, y: 0 }}
            exit={{ opacity: 0, scale: 0.97, y: 8 }}
            transition={spring}
          >
            <header>
              {icon}
              <h3>{title}</h3>
              <button className="btn icon sm ghost" onClick={onClose} aria-label="Закрыть">
                <X size={16} />
              </button>
            </header>
            <div className="content">{children}</div>
            {footer && <footer>{footer}</footer>}
          </motion.div>
        </motion.div>
      )}
    </AnimatePresence>
  )
}

export function Empty({
  icon,
  title,
  text,
  action
}: {
  icon: ReactNode
  title: string
  text: string
  action?: ReactNode
}) {
  return (
    <div className="empty">
      {icon}
      <b>{title}</b>
      <p>{text}</p>
      {action}
    </div>
  )
}

export function Ping({ ms }: { ms?: number }) {
  if (ms === undefined) return <span className="ping">—</span>
  if (ms < 0) return <span className="ping bad">нет ответа</span>
  const cls = ms < 150 ? 'good' : ms < 400 ? 'mid' : 'bad'
  return <span className={`ping ${cls}`}>{ms} мс</span>
}

/** Плавное появление содержимого страницы */
export function Fade({ children, k }: { children: ReactNode; k: string }) {
  return (
    <motion.div
      key={k}
      initial={{ opacity: 0, y: 8 }}
      animate={{ opacity: 1, y: 0 }}
      transition={{ duration: 0.22, ease: [0.22, 0.8, 0.3, 1] }}
    >
      {children}
    </motion.div>
  )
}
