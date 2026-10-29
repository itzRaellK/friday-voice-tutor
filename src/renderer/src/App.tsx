import { useCallback, useEffect, useRef, useState } from 'react'
import { Orb } from './components/Orb'
import { Captions } from './components/Captions'
import { HistoryPanel } from './components/HistoryPanel'
import { Composer } from './components/Composer'
import { SettingsMenu } from './components/SettingsMenu'
import type { OrbState } from './orb/OrbRenderer'
import { LANGUAGES, detectLanguageSwitch, findLanguage, voiceFor, type Language, type VoiceGender } from './lib/languages'
import { formatCorrection, greetingPrompt, replyReminder, tutorPrompt } from './lib/prompt'
import { ReplyStream, cleanForSpeech } from './lib/reply'
import { whichLanguage } from './lib/languageId'
import { reviewSentence, translateReply } from './lib/review'
import { detectWake, isFarewell } from './lib/wakeword'
import type { Message } from './lib/types'
import { SpeechPlayer, type PlayerState } from './audio/player'
import { Listener } from './audio/listener'
import { playCloseChime, playOpenChime } from './audio/sounds'

const HISTORY_LIMIT = 20
const VOICE: VoiceGender = 'female'
// A conversa por voz fecha sozinha depois deste tempo sem ninguém falar.
const CONVERSATION_IDLE_MS = 60_000
const STATE_LABEL: Record<OrbState, string> = { idle: 'ociosa', listening: 'ouvindo', thinking: 'pensando', speaking: 'falando' }

let nextId = 0
const newId = (): string => `m${Date.now()}-${nextId++}`

function stored(key: string): string | null {
  try {
    return localStorage.getItem(key)
  } catch {
    return null
  }
}
function store(key: string, value: string): void {
  try {
    localStorage.setItem(key, value)
  } catch {
    /* sem armazenamento: a preferência vale só nesta sessão */
  }
}

export function App(): React.JSX.Element {
  const [messages, setMessages] = useState<Message[]>([])
  const [lang, setLang] = useState<Language>(() => findLanguage(stored('friday-lang') ?? undefined) ?? LANGUAGES[0])
  // A língua do aluno: as traduções das falas da Friday e as explicações das correções vêm nela.
  const [native, setNative] = useState<Language>(() => findLanguage(stored('friday-native') ?? 'pt')!)
  const [busy, setBusy] = useState(false)
  const [voice, setVoice] = useState<PlayerState>('idle')
  const speaking = voice === 'playing'
  const [transcribing, setTranscribing] = useState(false)
  const [offline, setOffline] = useState(false)
  const [historyOpen, setHistoryOpen] = useState(() => stored('friday-history') !== 'closed')
  const [settingsOpen, setSettingsOpen] = useState(false)
  // O microfone abre com o app e fica em espera; o nome dela (ou um toque na esfera) abre a conversa.
  const [micError, setMicError] = useState(false)
  const [muted, setMuted] = useState(false)
  const [conversation, setConversation] = useState(false)
  const [hearing, setHearing] = useState(false) // o microfone detectou alguém falando

  // Callbacks de stream e do microfone leem sempre o valor atual.
  const state = useRef({ messages, lang, native, conversation })
  state.current = { messages, lang, native, conversation }

  const player = useRef<SpeechPlayer | null>(null)
  player.current ??= new SpeechPlayer(setVoice)
  const activeReply = useRef<string | null>(null)
  const listener = useRef<Listener | null>(null)
  const lastActivity = useRef(Date.now())
  const closeAfterReply = useRef(false)

  // Volume que a esfera usa: a voz dela enquanto fala, senão o microfone.
  const level = useCallback(() => player.current!.level() || (listener.current?.level() ?? 0), [])

  const patch = (id: string, change: Partial<Message>): void =>
    setMessages((ms) => ms.map((m) => (m.id === id ? { ...m, ...change } : m)))

  const speak = useCallback((text: string, language: Language): void => {
    player.current!.enqueue(text, voiceFor(language, VOICE))
  }, [])


  const changeLanguage = (l: Language): void => {
    setLang(l)
    state.current.lang = l
    store('friday-lang', l.code)
  }

  const openConversation = useCallback(() => {
    if (state.current.conversation) return
    playOpenChime()
    lastActivity.current = Date.now()
    state.current.conversation = true
    setConversation(true)
  }, [])

  const closeConversation = useCallback(() => {
    closeAfterReply.current = false
    if (!state.current.conversation) return
    playCloseChime()
    state.current.conversation = false
    setConversation(false)
  }, [])

  const send = useCallback(
    async (content: string, opts: { hidden?: boolean; viaVoice?: boolean } = {}) => {
      const { messages: prev, lang: current, native: mine } = state.current
      const requested = opts.hidden ? undefined : detectLanguageSwitch(content)
      const practice = requested ?? current
      if (requested && requested.code !== current.code) changeLanguage(requested)

      const now = Date.now()
      const userMsg: Message = { id: newId(), kind: 'user', raw: content, text: content, time: now, hidden: opts.hidden, viaVoice: opts.viaVoice }
      const reply: Message = { id: newId(), kind: 'assistant', raw: '', text: '', time: now, lang: practice.code, pending: true }
      setMessages((ms) => [...ms, userMsg, reply])
      setBusy(true)
      player.current!.stop()
      if (activeReply.current) void window.api.abortChat(activeReply.current)
      activeReply.current = reply.id

      const history = [...prev, userMsg]
        .filter((m) => m.raw && !m.error)
        .slice(-HISTORY_LIMIT)
        // A correção que o aluno viu vai junto, para a Friday poder explicá-la se ele perguntar.
        .map((m) => ({ role: m.kind, content: m.correction ? `${m.raw}
(Correction shown to the student: ${m.correction})` : m.raw }))

      const stream = new ReplyStream()
      const flush = (final: boolean): void => {
        if (activeReply.current !== reply.id) return
        for (const sentence of stream.takeSentences(final)) speak(sentence, practice)
      }

      const off = window.api.onToken((id, token) => {
        if (id !== reply.id) return
        stream.push(token)
        patch(reply.id, { raw: stream.raw, text: stream.visible })
        flush(false)
      })
      // O lembrete no fim pesa mais que o prompt inicial quando o histórico está em outro idioma.
      const chat = window.api.startChat(reply.id, [
        { role: 'system', content: tutorPrompt(mine, practice) },
        ...history,
        { role: 'system', content: replyReminder(practice) }
      ])

      // Se o aluno escreveu na língua de estudo, a frase é revisada em paralelo e a correção aparece
      // quando chegar. Perguntas na própria língua dele não têm o que corrigir.
      if (!opts.hidden && whichLanguage(content, mine, practice) === 'study') {
        reviewSentence(window.api.complete, mine, practice, content)
          .then((fix) => fix && patch(userMsg.id, { correction: formatCorrection(fix) }))
          .catch((err) => console.error('Revisão falhou:', err))
      }

      try {
        const full = await chat
        if (activeReply.current !== reply.id) return // interrompida
        // Os últimos tokens podem chegar depois da resposta do invoke; a resposta completa manda.
        if (full.startsWith(stream.raw)) stream.push(full.slice(stream.raw.length))
        flush(true)
        patch(reply.id, { raw: stream.raw, text: stream.visible, pending: false })
        setOffline(false)
        // A tradução vem depois da resposta inteira, sem atrasar a voz.
        if (whichLanguage(stream.visible, mine, practice) === 'study' && mine.code.split('-')[0] !== practice.code.split('-')[0]) {
          translateReply(window.api.complete, stream.visible, mine, practice)
            .then((translation) => translation && patch(reply.id, { translation }))
            .catch((err) => console.error('Tradução falhou:', err))
        }
      } catch (err) {
        if (activeReply.current !== reply.id) return // conversa reiniciada ou interrompida
        console.error(err)
        setOffline(true)
        patch(reply.id, { pending: false, error: true, text: `Não consegui falar com o Ollama. Ele está rodando? (${(err as Error).message})` })
      } finally {
        off()
        if (activeReply.current === reply.id) {
          activeReply.current = null
          setBusy(false)
        }
      }
    },
    [speak]
  )

  /** Para a fala e, se ainda estiver gerando, a resposta também (o texto já recebido fica). */
  const interrupt = useCallback(() => {
    player.current!.stop()
    const id = activeReply.current
    if (!id) return
    void window.api.abortChat(id)
    activeReply.current = null
    setBusy(false)
    setMessages((ms) => ms.map((m) => (m.id === id ? { ...m, pending: false } : m)))
  }, [])

  const greet = useCallback(() => void send(greetingPrompt(state.current.lang), { hidden: true }), [send])

  const greeted = useRef(false)
  useEffect(() => {
    if (greeted.current) return
    greeted.current = true
    greet()
  }, [greet])

  // ---- microfone ----

  const onUtterance = useCallback(
    async (wav: Uint8Array) => {
      // Em espera, cada fala é checada em silêncio: a UI só reage se for o nome dela.
      const inConversation = state.current.conversation
      if (inConversation) setTranscribing(true)
      try {
        const text = await window.api.transcribe(wav)
        if (!text) return
        if (state.current.conversation) {
          lastActivity.current = Date.now()
          // Despedida: ela responde e a conversa fecha quando terminar de falar.
          if (isFarewell(text)) closeAfterReply.current = true
          void send(text, { viaVoice: true })
          return
        }
        const called = detectWake(text)
        if (!called) return
        openConversation()
        if (called.rest) void send(called.rest, { viaVoice: true })
      } catch (err) {
        console.error('Transcrição falhou:', err)
      } finally {
        if (inConversation) setTranscribing(false)
      }
    },
    [send, openConversation]
  )
  const onUtteranceRef = useRef(onUtterance)
  onUtteranceRef.current = onUtterance
  const interruptRef = useRef(interrupt)
  interruptRef.current = interrupt

  listener.current ??= new Listener({
    onSpeechStart: () => {
      lastActivity.current = Date.now()
      setHearing(true)
    },
    onSpeechEnd: () => setHearing(false),
    onUtterance: (wav) => void onUtteranceRef.current(wav),
    // Só dá para interromper a Friday dentro de uma conversa; em espera, a fala dela segue.
    onBargeIn: () => state.current.conversation && interruptRef.current()
  })

  const startMic = useCallback(async () => {
    try {
      await listener.current!.start()
      setMicError(false)
    } catch (err) {
      console.error('Microfone indisponível:', err)
      setMicError(true)
    }
  }, [])

  useEffect(() => {
    void startMic()
    return () => listener.current?.stop()
  }, [startMic])

  // Enquanto ela pensa ou fala, o microfone só aceita interrupções fortes (evita ouvir a própria voz).
  const fridayBusy = busy || transcribing || voice !== 'idle'
  useEffect(() => {
    if (listener.current) listener.current.guarded = fridayBusy
    if (fridayBusy) return
    lastActivity.current = Date.now() // o minuto de silêncio conta a partir do fim da resposta
    if (closeAfterReply.current) closeConversation()
  }, [fridayBusy, closeConversation])

  // Um minuto sem ninguém falar fecha a conversa e o microfone volta a esperar o nome.
  useEffect(() => {
    if (!conversation) return
    const timer = window.setInterval(() => {
      if (!fridayBusy && !hearing && Date.now() - lastActivity.current > CONVERSATION_IDLE_MS) closeConversation()
    }, 1000)
    return () => window.clearInterval(timer)
  }, [conversation, fridayBusy, hearing, closeConversation])

  const onToggleMute = (): void => {
    if (micError) {
      void startMic()
      return
    }
    const next = !muted
    setMuted(next)
    listener.current!.paused = next
    if (next) closeConversation()
  }

  // Tema salvo; o main aplica no Electron e o CSS segue prefers-color-scheme.
  useEffect(() => {
    const saved = stored('friday-theme')
    if (saved === 'light' || saved === 'dark') void window.api.setTheme(saved)
  }, [])

  const toggleTheme = (): void => {
    const next = matchMedia('(prefers-color-scheme: dark)').matches ? 'light' : 'dark'
    store('friday-theme', next)
    void window.api.setTheme(next)
  }

  const closeSettings = useCallback(() => setSettingsOpen(false), [])

  const toggleHistory = (): void => {
    store('friday-history', historyOpen ? 'closed' : 'open')
    setHistoryOpen(!historyOpen)
  }

  const newChat = (): void => {
    interrupt()
    closeConversation()
    setMessages([])
    state.current.messages = []
    greet()
  }

  const onLanguageChange = (code: string): void => {
    const l = findLanguage(code)
    if (l && l.code !== lang.code) changeLanguage(l)
  }

  const onNativeChange = (code: string): void => {
    const l = findLanguage(code)
    if (!l) return
    setNative(l)
    state.current.native = l
    store('friday-native', l.code)
  }

  const onReplay = (m: Message): void => {
    player.current!.stop()
    const spoken = cleanForSpeech(m.text)
    if (spoken) speak(spoken, findLanguage(m.lang) ?? lang)
  }

  // Tocar na esfera: interrompe se ela estiver falando; senão abre ou fecha a conversa por voz.
  const onOrb = (): void => {
    if (voice !== 'idle' || busy) interrupt()
    else if (conversation) closeConversation()
    else if (!muted && !micError) openConversation()
  }

  useEffect(() => {
    const onKey = (e: KeyboardEvent): void => {
      if (e.key === 'Escape') player.current!.stop()
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [])

  const micLive = !muted && !micError
  const orbState: OrbState =
    hearing && micLive && !fridayBusy && conversation ? 'listening' : speaking ? 'speaking' : fridayBusy ? 'thinking' : 'idle'
  let label = STATE_LABEL[orbState]
  let tone: string = orbState
  if (offline) [label, tone] = ['sem conexão', 'offline']
  else if (orbState === 'idle' && micError) [label, tone] = ['sem microfone', 'offline']
  else if (orbState === 'idle' && muted) [label, tone] = ['microfone desligado', 'muted']
  else if (orbState === 'idle' && conversation) [label, tone] = ['conversando', 'talking']
  else if (orbState === 'idle') label = 'diga “Friday”'

  const visible = messages.filter((m) => !m.hidden)
  const reply = [...visible].reverse().find((m) => m.kind === 'assistant')
  const lastUser = [...visible].reverse().find((m) => m.kind === 'user')
  const user = lastUser && reply && lastUser.time <= reply.time ? lastUser : undefined

  return (
    <div className="app">
      <header className="titlebar">
        <span className="wordmark">FRIDAY</span>
        <span className={`state ${tone}`} title={`Praticando ${lang.name}`}>
          <i />
          {label}
        </span>
        <span className="grow" />
        <button
          type="button"
          className="icon-btn"
          data-settings-toggle
          onClick={() => setSettingsOpen(!settingsOpen)}
          aria-label="Idiomas"
          title={`Idiomas · estudando ${lang.name}`}
          aria-expanded={settingsOpen}
        >
          <svg viewBox="0 0 24 24">
            <circle cx="12" cy="12" r="3" />
            <path d="M19.4 15a1.7 1.7 0 0 0 .3 1.8l.1.1a2 2 0 1 1-2.8 2.8l-.1-.1a1.7 1.7 0 0 0-1.8-.3 1.7 1.7 0 0 0-1 1.5V21a2 2 0 1 1-4 0v-.1a1.7 1.7 0 0 0-1.1-1.5 1.7 1.7 0 0 0-1.8.3l-.1.1a2 2 0 1 1-2.8-2.8l.1-.1a1.7 1.7 0 0 0 .3-1.8 1.7 1.7 0 0 0-1.5-1H3a2 2 0 1 1 0-4h.1a1.7 1.7 0 0 0 1.5-1.1 1.7 1.7 0 0 0-.3-1.8l-.1-.1a2 2 0 1 1 2.8-2.8l.1.1a1.7 1.7 0 0 0 1.8.3H9a1.7 1.7 0 0 0 1-1.5V3a2 2 0 1 1 4 0v.1a1.7 1.7 0 0 0 1 1.5 1.7 1.7 0 0 0 1.8-.3l.1-.1a2 2 0 1 1 2.8 2.8l-.1.1a1.7 1.7 0 0 0-.3 1.8V9a1.7 1.7 0 0 0 1.5 1H21a2 2 0 1 1 0 4h-.1a1.7 1.7 0 0 0-1.5 1z" />
          </svg>
        </button>
        <button type="button" className="icon-btn" onClick={toggleTheme} aria-label="Alternar tema claro ou escuro">
          <svg viewBox="0 0 24 24">
            <circle cx="12" cy="12" r="4.5" />
            <path d="M12 2.5v2M12 19.5v2M2.5 12h2M19.5 12h2M5.3 5.3l1.4 1.4M17.3 17.3l1.4 1.4M5.3 18.7l1.4-1.4M17.3 6.7l1.4-1.4" />
          </svg>
        </button>
        <button type="button" className="icon-btn" onClick={toggleHistory} aria-label="Mostrar ou esconder o histórico" aria-expanded={historyOpen}>
          <svg viewBox="0 0 24 24">
            <rect x="3.5" y="4.5" width="17" height="15" rx="2.5" />
            <path d="M14.5 4.5v15" />
          </svg>
        </button>
      </header>

      <SettingsMenu
        open={settingsOpen}
        native={native}
        study={lang}
        onNativeChange={onNativeChange}
        onStudyChange={onLanguageChange}
        onClose={closeSettings}
      />

      <div className="stage">
        <main className="main">
          <Orb state={orbState} level={level} onClick={onOrb} />
          <Captions user={user} reply={reply} transcribing={transcribing} />
          <Composer disabled={busy || transcribing} muted={!micLive} conversation={conversation} onSubmit={(t) => void send(t)} onToggleMute={onToggleMute} />
        </main>
        <HistoryPanel
          open={historyOpen}
          messages={messages}
          onNewChat={newChat}
          onReplay={onReplay}
        />
      </div>
    </div>
  )
}
