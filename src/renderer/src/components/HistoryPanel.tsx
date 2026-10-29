import { useEffect, useRef } from 'react'
import type { Message } from '../lib/types'

interface Props {
  open: boolean
  messages: Message[]
  onNewChat: () => void
  onReplay: (m: Message) => void
}

const clock = (t: number): string => new Date(t).toLocaleTimeString('pt-BR', { hour: '2-digit', minute: '2-digit' })

export function HistoryPanel({ open, messages, onNewChat, onReplay }: Props): React.JSX.Element {
  const list = useRef<HTMLDivElement>(null)
  useEffect(() => {
    if (list.current) list.current.scrollTop = list.current.scrollHeight
  }, [messages])

  const visible = messages.filter((m) => !m.hidden && (m.text || !m.pending))

  return (
    <aside className="history" data-open={open} aria-label="Histórico da conversa" aria-hidden={!open}>
      <div className="history-inner">
        <header className="history-head">
          <h2>Conversa</h2>
          <button type="button" className="text-btn" onClick={onNewChat} tabIndex={open ? 0 : -1}>
            Nova conversa
          </button>
        </header>

        <div className="turns" ref={list}>
          {visible.length === 0 && <p className="empty">As mensagens aparecem aqui.</p>}
          {visible.map((m) => (
            <div key={m.id} className={`turn ${m.kind}${m.error ? ' error' : ''}`}>
              <span className="meta">
                {clock(m.time)}
                {m.lang && ` · ${m.lang.toUpperCase()}`}
                {m.viaVoice && ' · voz'}
                {m.kind === 'assistant' && !m.pending && !m.error && (
                  <button type="button" className="replay" onClick={() => onReplay(m)} tabIndex={open ? 0 : -1} aria-label="Ouvir de novo">
                    ouvir
                  </button>
                )}
              </span>
              <span className="body">{m.text}</span>
              {m.translation && <span className="translated">{m.translation}</span>}
              {m.correction && <span className="fix">{m.correction}</span>}
            </div>
          ))}
        </div>

      </div>
    </aside>
  )
}
