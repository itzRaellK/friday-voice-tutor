import type { Message } from '../lib/types'

interface Props {
  user?: Message
  reply?: Message
  transcribing: boolean
}

// A última troca em destaque: a fala do aluno pequena, a da Friday grande (na língua de estudo, como
// foi falada) com a tradução logo abaixo, e a correção discreta.
export function Captions({ user, reply, transcribing }: Props): React.JSX.Element {
  return (
    <div className="captions" aria-live="polite">
      <div className="user-line">{transcribing ? <span className="hint">transcrevendo…</span> : user?.text}</div>
      <p className={`friday-line${reply?.error ? ' error' : ''}`}>{reply?.text}</p>
      <p className={`translation${reply?.translation ? ' show' : ''}`}>{reply?.translation}</p>
      <div className={`correction${user?.correction ? ' show' : ''}`}>
        {user?.correction && (
          <>
            <b>Correção</b> · {user.correction}
          </>
        )}
      </div>
    </div>
  )
}
