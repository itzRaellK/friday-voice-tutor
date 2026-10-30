import { toWav16k } from './wav'

// Canal de escuta sempre aberto (modos "Friday" e "Contínua").
// Um detector de voz por energia separa cada fala: começa quando o volume passa bem acima do
// ruído de fundo e termina depois de um silêncio. Cada fala sai como WAV pronto para transcrever.

const FRAME = 2048 // ~43 ms a 48 kHz
const PRE_ROLL_S = 0.35 // áudio guardado de antes do início detectado, para não cortar a primeira sílaba
// Detectar uma interrupção leva ~1 s, então durante a fala dela guarda mais para trás.
const PRE_ROLL_GUARDED_S = 1.5
const START_FRAMES = 3 // ~130 ms acima do limiar para considerar que começou a falar
const END_SILENCE_S = 3
const MIN_SPEECH_S = 0.35
const MIN_THRESHOLD = 0.012
const NOISE_RATIO = 3
// Enquanto a Friday fala, só uma voz bem mais forte (o aluno interrompendo) conta.
const BARGE_IN_RATIO = 4
const BARGE_IN_MIN = 0.05
const BARGE_IN_FRAMES = 6 // saldo de ~260 ms de voz forte

export interface ListenerEvents {
  onSpeechStart: () => void
  /** Sempre vem depois de onSpeechStart, mesmo quando a fala era curta demais e foi descartada. */
  onSpeechEnd: () => void
  onUtterance: (wav: Uint8Array) => void
  /** O aluno falou por cima da Friday. */
  onBargeIn: () => void
}

export class Listener {
  private ctx: AudioContext | null = null
  private stream: MediaStream | null = null
  private node: ScriptProcessorNode | null = null
  private noise = 0.005
  private energy = 0
  private loud = 0
  private quiet = 0
  private speaking = false
  private preRoll: Float32Array[] = []
  private speech: Float32Array[] = []
  private speechFrames = 0
  /** Quando true (a Friday está falando ou pensando), só interrupções fortes contam. */
  guarded = false
  paused = false

  constructor(private events: ListenerEvents) {}

  /** Volume atual do microfone (0..1). */
  level = (): number => (this.ctx ? Math.min(1, this.energy * 5) : 0)

  get active(): boolean {
    return this.ctx !== null
  }

  async start(): Promise<void> {
    if (this.ctx) return
    this.stream = await navigator.mediaDevices.getUserMedia({
      audio: { echoCancellation: true, noiseSuppression: true, autoGainControl: true }
    })
    this.ctx = new AudioContext()
    const source = this.ctx.createMediaStreamSource(this.stream)
    // ScriptProcessor é obsoleto, mas dispensa um arquivo de AudioWorklet separado e basta para ler quadros.
    this.node = this.ctx.createScriptProcessor(FRAME, 1, 1)
    this.node.onaudioprocess = (e) => this.process(new Float32Array(e.inputBuffer.getChannelData(0)))
    source.connect(this.node)
    this.node.connect(this.ctx.destination) // necessário para o processador rodar; a saída é silêncio
  }

  stop(): void {
    if (this.speaking) this.events.onSpeechEnd()
    this.node?.disconnect()
    this.stream?.getTracks().forEach((t) => t.stop())
    void this.ctx?.close()
    this.ctx = null
    this.node = null
    this.stream = null
    this.reset()
  }

  private reset(): void {
    this.speaking = false
    this.speech = []
    this.speechFrames = 0
    this.loud = 0
    this.quiet = 0
  }

  private process(frame: Float32Array): void {
    let sum = 0
    for (let i = 0; i < frame.length; i++) sum += frame[i] * frame[i]
    const rms = Math.sqrt(sum / frame.length)
    this.energy = rms
    const rate = this.ctx!.sampleRate
    const frameS = frame.length / rate

    if (this.paused) {
      if (this.speaking) this.events.onSpeechEnd()
      this.reset()
      return
    }

    if (this.guarded && !this.speaking) {
      // Durante a fala da Friday: o eco que sobra do cancelamento não deve virar uma fala do aluno.
      const strong = rms > Math.max(BARGE_IN_MIN, this.noise * BARGE_IN_RATIO)
      // Contador que desce devagar: as pausas entre sílabas não zeram a interrupção.
      this.loud = strong ? this.loud + 1 : Math.max(0, this.loud - 1)
      this.keepPreRoll(frame, frameS)
      if (this.loud >= BARGE_IN_FRAMES) {
        this.events.onBargeIn()
        this.begin()
      }
      return
    }

    const threshold = Math.max(MIN_THRESHOLD, this.noise * NOISE_RATIO)
    if (!this.speaking) {
      // O ruído de fundo só aprende com quadros quietos; senão o começo de cada fala o inflaria.
      if (rms < threshold) this.noise = this.noise * 0.95 + rms * 0.05
      this.loud = rms > threshold ? this.loud + 1 : 0
      this.keepPreRoll(frame, frameS)
      if (this.loud >= START_FRAMES) this.begin()
      return
    }

    this.speech.push(frame)
    this.speechFrames++
    this.quiet = rms > threshold ? 0 : this.quiet + 1
    const duration = this.speechFrames * frameS
    // Duração não encerra o turno: falas longas são divididas apenas na transcrição.
    if (this.quiet * frameS >= END_SILENCE_S) this.finish(duration - this.quiet * frameS)
  }

  private keepPreRoll(frame: Float32Array, frameS: number): void {
    this.preRoll.push(frame)
    const keep = this.guarded ? PRE_ROLL_GUARDED_S : PRE_ROLL_S
    while (this.preRoll.length * frameS > keep) this.preRoll.shift()
  }

  private begin(): void {
    this.speaking = true
    this.speech = [...this.preRoll]
    this.speechFrames = 0
    this.quiet = 0
    this.loud = 0
    this.preRoll = []
    this.events.onSpeechStart()
  }

  private finish(voiced: number): void {
    const frames = this.speech
    const rate = this.ctx!.sampleRate
    this.reset()
    this.events.onSpeechEnd()
    if (voiced < MIN_SPEECH_S) return // estalo, tosse, porta batendo
    const samples = new Float32Array(frames.reduce((n, f) => n + f.length, 0))
    let offset = 0
    for (const f of frames) {
      samples.set(f, offset)
      offset += f.length
    }
    void toWav16k(samples, rate).then((wav) => this.events.onUtterance(wav))
  }
}
