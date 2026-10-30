import { WavStreamDecoder } from './wav'
import { createAnalyser } from './level'

/** waiting: há respostas na fila, mas nenhum áudio pronto para tocar. */
export type PlayerState = 'idle' | 'waiting' | 'playing'

export interface PlaybackDiagnostic {
  event: string
  at: number
  state: PlayerState
  queued: number
  scheduledS: number
  id?: string
  reason?: string
  audioS?: number
}

interface Track {
  id: string
  decoder: WavStreamDecoder
  pending: Float32Array[] // amostras recebidas e ainda não agendadas
  buffered: number
  text: string
  voice: string
  requested: boolean
  done: boolean
  succeeded: boolean
  error?: Error
  callbacks: PlaybackCallbacks
}

interface PlaybackCallbacks {
  onStart?: () => void
  onError?: (error: Error) => void
  onCancel?: () => void
}

let nextId = 0

// Cada item toca como um único buffer completo, após o fim dos bytes e o sucesso da síntese.
// A resposta pode conter várias frases: o texto só é revelado quando play() confirma o início.
export class SpeechPlayer {
  private ctx = new AudioContext()
  private out = createAnalyser(this.ctx)
  private tracks: Track[] = []
  private sources = new Set<AudioBufferSourceNode>()
  private nextTime = 0
  private state: PlayerState = 'idle'
  private generating: Track | null = null

  constructor(
    private onStateChange: (state: PlayerState) => void,
    private onDiagnostic: (event: PlaybackDiagnostic) => void = (event) => console.debug('[Friday áudio]', event)
  ) {
    this.out.analyser.connect(this.ctx.destination)
    window.api.onSpeechChunk((id, chunk) => this.receive(id, chunk))
  }

  /** Volume da voz que está tocando agora (0..1). */
  level = (): number => (this.sources.size ? this.out.level() : 0)

  enqueue(text: string, voice: string, callbacks: PlaybackCallbacks = {}): void {
    const track: Track = {
      id: `tts${Date.now()}-${nextId++}`, decoder: new WavStreamDecoder(), pending: [],
      buffered: 0, text, voice, requested: false, done: false, succeeded: false, callbacks
    }
    this.tracks.push(track)
    this.trace('queued', { id: track.id })
    this.generateNext()
    this.update()
  }

  /** Resolve ao agendar o áudio completo; false significa que a preparação foi cancelada. */
  play(text: string, voice: string): Promise<boolean> {
    return new Promise((resolve, reject) => this.enqueue(text, voice, {
      onStart: () => resolve(true), onCancel: () => resolve(false), onError: reject
    }))
  }

  stop(reason = 'manual'): void {
    this.trace('stop', { reason })
    for (const t of this.tracks) {
      if (t.requested && !t.succeeded) void window.api.abortSpeech(t.id)
      t.callbacks.onCancel?.()
    }
    this.tracks = []
    this.generating = null
    for (const s of this.sources) {
      s.onended = null
      s.stop()
    }
    this.sources.clear()
    this.nextTime = 0
    this.update()
  }

  private generateNext(): void {
    if (this.generating) return
    const track = this.tracks.find((t) => !t.requested && !t.done)
    if (!track) return
    track.requested = true
    this.generating = track
    this.trace('generating', { id: track.id })
    void window.api.streamSpeech(track.id, track.text, track.voice)
      .then(() => {
        if (!this.tracks.includes(track)) return
        track.succeeded = true
        this.pump()
      })
      .catch((err) => {
        if (!this.tracks.includes(track)) return // resposta interrompida
        console.error('TTS falhou:', err)
        this.trace('error', { id: track.id, reason: String(err) })
        // Não deixa a fila presa caso o IPC falhe antes de enviar o marcador final.
        track.done = true
        track.error = err instanceof Error ? err : new Error(String(err))
        track.pending = []
        track.buffered = 0
        this.pump()
      })
      .finally(() => {
        if (this.generating !== track) return // finalização de uma resposta antiga
        this.generating = null
        // A resolução do invoke não é o fim do áudio: o marcador null chega por outro canal.
        this.generateNext()
      })
  }

  private receive(id: string, chunk: Uint8Array | null): void {
    const track = this.tracks.find((t) => t.id === id)
    if (!track || track.done) return // frase interrompida por stop() ou já encerrada
    if (chunk === null) {
      track.done = true
      this.trace('bytes-complete', { id, audioS: track.buffered })
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
        track.buffered = 0
        track.error = err instanceof Error ? err : new Error(String(err))
        this.trace('error', { id, reason: String(err) })
        void window.api.abortSpeech(id)
      }
    }
    this.pump()
  }

  private pump(): void {
    while (this.tracks.length) {
      const t = this.tracks[0]
      if (!t.error && (!t.done || !t.succeeded)) break
      if (t.error || !t.pending.length) {
        const error = t.error ?? new Error('O modelo de voz não devolveu áudio.')
        this.tracks.shift()
        t.callbacks.onError?.(error)
        continue
      }
      this.schedule(t)
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
    // Agenda a frase completa no relógio do áudio, independentemente dos renders da interface.
    const at = Math.max(this.nextTime, this.ctx.currentTime + 0.03)
    src.start(at)
    this.nextTime = at + buffer.duration
    this.sources.add(src)
    this.trace('scheduled', { id: t.id, audioS: buffer.duration })
    t.callbacks.onStart?.()
    src.onended = () => {
      this.sources.delete(src)
      this.pump()
    }
  }

  private update(): void {
    const state: PlayerState = this.sources.size ? 'playing' : this.tracks.length ? 'waiting' : 'idle'
    if (state === this.state) return
    this.state = state
    this.trace('state')
    this.onStateChange(state)
  }

  private trace(event: string, detail: Pick<PlaybackDiagnostic, 'id' | 'reason' | 'audioS'> = {}): void {
    this.onDiagnostic({
      event, at: performance.now(), state: this.state, queued: this.tracks.length,
      scheduledS: Math.max(0, this.nextTime - this.ctx.currentTime), ...detail
    })
  }
}
