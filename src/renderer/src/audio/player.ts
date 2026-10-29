import { WavStreamDecoder } from './wav'
import { createAnalyser } from './level'

/** waiting: há falas na fila, mas nenhum áudio tocando ainda. */
export type PlayerState = 'idle' | 'waiting' | 'playing'

// Antes de começar uma frase, junta um pouco de áudio para não engasgar se a geração atrasar.
const PREBUFFER_S = 0.3
// Pedaços muito curtos viram um AudioBuffer só, para não agendar centenas de fontes minúsculas.
const MIN_CHUNK_S = 0.1

interface Track {
  id: string
  decoder: WavStreamDecoder
  pending: Float32Array[] // amostras recebidas e ainda não agendadas
  buffered: number // segundos em `pending`
  started: boolean
  done: boolean
}

let nextId = 0

// Cada frase vira um stream de voz que começa a tocar assim que chega áudio suficiente.
// As frases tocam na ordem em que entraram, emendadas sem pausa.
export class SpeechPlayer {
  private ctx = new AudioContext()
  private out = createAnalyser(this.ctx)
  private tracks: Track[] = []
  private sources = new Set<AudioBufferSourceNode>()
  private nextTime = 0
  private state: PlayerState = 'idle'

  constructor(private onStateChange: (state: PlayerState) => void) {
    this.out.analyser.connect(this.ctx.destination)
    window.api.onSpeechChunk((id, chunk) => this.receive(id, chunk))
  }

  /** Volume da voz que está tocando agora (0..1). */
  level = (): number => (this.sources.size ? this.out.level() : 0)

  enqueue(text: string, voice: string): void {
    const track: Track = { id: `tts${Date.now()}-${nextId++}`, decoder: new WavStreamDecoder(), pending: [], buffered: 0, started: false, done: false }
    this.tracks.push(track)
    window.api.streamSpeech(track.id, text, voice).catch((err) => {
      if (!String(err).includes('AbortError')) console.error('TTS falhou:', err)
    })
    this.update()
  }

  stop(): void {
    for (const t of this.tracks) if (!t.done) void window.api.abortSpeech(t.id)
    this.tracks = []
    for (const s of this.sources) {
      s.onended = null
      s.stop()
    }
    this.sources.clear()
    this.nextTime = 0
    this.update()
  }

  private receive(id: string, chunk: Uint8Array | null): void {
    const track = this.tracks.find((t) => t.id === id)
    if (!track) return // frase interrompida por stop()
    if (chunk === null) {
      track.done = true
    } else {
      try {
        const samples = track.decoder.push(chunk)
        if (samples.length) {
          track.pending.push(samples)
          track.buffered += samples.length / track.decoder.sampleRate
        }
      } catch (err) {
        console.error('Áudio inválido:', err)
        track.done = true
        track.pending = []
        void window.api.abortSpeech(id)
      }
    }
    this.pump()
  }

  private pump(): void {
    while (this.tracks.length) {
      const t = this.tracks[0]
      if (!t.started) {
        if (t.buffered < PREBUFFER_S && !t.done) break
        t.started = true
      }
      if (t.buffered >= MIN_CHUNK_S || (t.done && t.pending.length)) this.schedule(t)
      if (!t.done || t.pending.length) break
      this.tracks.shift() // frase toda agendada; a próxima emenda no fim desta
    }
    this.update()
  }

  private schedule(t: Track): void {
    const length = t.pending.reduce((n, p) => n + p.length, 0)
    const buffer = this.ctx.createBuffer(1, length, t.decoder.sampleRate)
    const data = buffer.getChannelData(0)
    let offset = 0
    for (const p of t.pending) {
      data.set(p, offset)
      offset += p.length
    }
    t.pending = []
    t.buffered = 0

    if (this.ctx.state === 'suspended') void this.ctx.resume()
    const src = this.ctx.createBufferSource()
    src.buffer = buffer
    src.connect(this.out.analyser)
    // Se a geração atrasou e o áudio anterior já acabou, recomeça logo à frente do relógio.
    const at = Math.max(this.nextTime, this.ctx.currentTime + 0.03)
    src.start(at)
    this.nextTime = at + buffer.duration
    this.sources.add(src)
    src.onended = () => {
      this.sources.delete(src)
      this.pump()
    }
  }

  private update(): void {
    const state: PlayerState = this.sources.size ? 'playing' : this.tracks.length ? 'waiting' : 'idle'
    if (state === this.state) return
    this.state = state
    this.onStateChange(state)
  }
}
