import { transcribeAudio } from './transcription'

// Cliente mínimo do Ollama usado pelo main process.
// Cada papel tem seu modelo: um modelo mais forte ouve e conversa, o lfm3-omni só dá voz ao texto.

export const OLLAMA_URL = process.env.OLLAMA_HOST
  ? `http://${process.env.OLLAMA_HOST.replace(/^https?:\/\//, '')}`
  : 'http://127.0.0.1:11434'

// Cada papel aponta para uma variante local com contexto pequeno. O contexto padrão (128k)
// enche a VRAM de 6 GB a ponto de a voz ficar mais lenta que o tempo real, e o /v1 da
// transcrição não aceita num_ctx: sem a variante, o gemma recarregaria a cada troca de API.
// As variantes reaproveitam os arquivos do modelo base (nada é baixado).
const VARIANTS = {
  brain: { name: 'friday-brain', from: process.env.FRIDAY_CHAT_MODEL ?? 'gemma4:e2b', ctx: 8192 },
  voice: { name: 'friday-voice', from: process.env.FRIDAY_TTS_MODEL ?? 'lfm3-omni', ctx: 4096 }
}

export const MODELS = {
  chat: VARIANTS.brain.from,
  stt: VARIANTS.brain.from,
  tts: VARIANTS.voice.from
}

/** Cria as variantes que faltarem e passa a usá-las; se falhar, segue com os modelos base. */
export async function ensureModels(): Promise<void> {
  const tags = (await (await fetch(`${OLLAMA_URL}/api/tags`)).json()) as { models: { name: string }[] }
  const have = new Set(tags.models.map((m) => m.name.split(':')[0]))
  for (const v of Object.values(VARIANTS)) {
    if (have.has(v.name)) continue
    const res = await fetch(`${OLLAMA_URL}/api/create`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ model: v.name, from: v.from, parameters: { num_ctx: v.ctx }, stream: false })
    })
    if (!res.ok) throw new Error(`Ollama /api/create ${v.name}: ${res.status} ${await res.text()}`)
  }
  MODELS.chat = MODELS.stt = VARIANTS.brain.name
  MODELS.tts = VARIANTS.voice.name
}

export interface ChatMessage {
  role: 'system' | 'user' | 'assistant'
  content: string
}

/** Faz stream da resposta e devolve o texto completo ao final. */
export async function streamChat(
  messages: ChatMessage[],
  onToken: (token: string) => void,
  signal: AbortSignal
): Promise<string> {
  const res = await fetch(`${OLLAMA_URL}/api/chat`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      model: MODELS.chat,
      messages,
      stream: true,
      think: false, // o gemma4 "pensa" por padrão; aqui atrasaria a resposta sem ganho
      keep_alive: '30m',
      options: { temperature: 0.7 }
    }),
    signal
  })
  if (!res.ok || !res.body) throw new Error(`Ollama /api/chat: ${res.status} ${await res.text()}`)

  const decoder = new TextDecoder()
  let buffer = ''
  let full = ''
  for await (const chunk of res.body as unknown as AsyncIterable<Uint8Array>) {
    buffer += decoder.decode(chunk, { stream: true })
    let nl: number
    while ((nl = buffer.indexOf('\n')) >= 0) {
      const line = buffer.slice(0, nl).trim()
      buffer = buffer.slice(nl + 1)
      if (!line) continue
      const data = JSON.parse(line)
      if (data.error) throw new Error(data.error)
      if (data.message?.content) {
        full += data.message.content
        onToken(data.message.content)
      }
    }
  }
  return full
}

/** Resposta curta e determinística, sem stream. `format` é um JSON Schema que o Ollama impõe à saída. */
export async function complete(messages: ChatMessage[], format?: object): Promise<string> {
  const res = await fetch(`${OLLAMA_URL}/api/chat`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ model: MODELS.chat, messages, format, stream: false, think: false, keep_alive: '30m', options: { temperature: 0 } })
  })
  if (!res.ok) throw new Error(`Ollama /api/chat: ${res.status} ${await res.text()}`)
  const data = (await res.json()) as { message?: { content?: string } }
  return data.message?.content ?? ''
}

/** Repassa o WAV em pedaços conforme o Ollama gera; o primeiro chega bem antes do arquivo completo. */
export async function speakStream(
  text: string,
  voice: string,
  onChunk: (chunk: Uint8Array) => void,
  signal: AbortSignal
): Promise<void> {
  const res = await fetch(`${OLLAMA_URL}/v1/audio/speech`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ model: MODELS.tts, input: text, voice }),
    signal
  })
  if (!res.ok || !res.body) throw new Error(`Ollama /v1/audio/speech: ${res.status} ${await res.text()}`)
  for await (const chunk of res.body as unknown as AsyncIterable<Uint8Array>) onChunk(chunk)
}

export async function speak(text: string, voice: string): Promise<Uint8Array> {
  const res = await fetch(`${OLLAMA_URL}/v1/audio/speech`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ model: MODELS.tts, input: text, voice })
  })
  if (!res.ok) throw new Error(`Ollama /v1/audio/speech: ${res.status} ${await res.text()}`)
  return new Uint8Array(await res.arrayBuffer())
}

export async function transcribe(wav: Uint8Array): Promise<string> {
  return transcribeAudio(wav, transcribeChunk)
}

async function transcribeChunk(wav: Uint8Array): Promise<string> {
  const form = new FormData()
  form.append('model', MODELS.stt)
  form.append('file', new Blob([wav as BlobPart], { type: 'audio/wav' }), 'speech.wav')
  const res = await fetch(`${OLLAMA_URL}/v1/audio/transcriptions`, { method: 'POST', body: form })
  if (!res.ok) throw new Error(`Ollama /v1/audio/transcriptions: ${res.status} ${await res.text()}`)
  const data = (await res.json()) as { text?: string }
  return (data.text ?? '').trim()
}
