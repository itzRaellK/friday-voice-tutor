import { useState } from 'react'

interface Props {
  disabled: boolean
  muted: boolean
  conversation: boolean
  onSubmit: (text: string) => void
  onToggleMute: () => void
}

// Escrever funciona sempre; o botão só liga e desliga o microfone, que fica aberto por padrão.
export function Composer({ disabled, muted, conversation, onSubmit, onToggleMute }: Props): React.JSX.Element {
  const [text, setText] = useState('')

  const submit = (): void => {
    const t = text.trim()
    if (!t || disabled) return
    onSubmit(t)
    setText('')
  }

  const label = muted ? 'Ligar o microfone' : 'Desligar o microfone'

  return (
    <form
      className="composer"
      onSubmit={(e) => {
        e.preventDefault()
        submit()
      }}
    >
      <input
        id="message"
        className="field"
        value={text}
        placeholder={
          muted ? 'Microfone desligado. Escreva uma mensagem…' : conversation ? 'Pode falar, ou escreva…' : 'Escreva, ou diga “Friday”…'
        }
        onChange={(e) => setText(e.target.value)}
        autoComplete="off"
        autoFocus
      />
      <button type="button" className={`mic${muted ? ' muted' : ''}`} onClick={onToggleMute} aria-label={label} aria-pressed={muted} title={label}>
        <svg viewBox="0 0 24 24">
          <rect x="9" y="3" width="6" height="11" rx="3" />
          <path d="M5 11a7 7 0 0 0 14 0M12 18v3" />
          {muted && <path d="M4 4l16 16" />}
        </svg>
      </button>
    </form>
  )
}
