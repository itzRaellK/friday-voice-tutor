import assert from 'node:assert/strict'
import { test } from 'node:test'
import { SpeechPlayer, type PlayerState, type PlaybackDiagnostic } from '../src/renderer/src/audio/player'
import { encodeWav } from '../src/renderer/src/audio/wav'

class FakeSource {
  buffer: { duration: number } | null = null
  onended: (() => void) | null = null
  at = Infinity
  ended = false
  stopped = false
  connect(): void {}
  start(at: number): void { this.at = at }
  stop(): void { this.stopped = true }
  get end(): number { return this.at + (this.buffer?.duration ?? 0) }
}

class FakeContext {
  currentTime = 0
  state = 'running'
  destination = {}
  sources: FakeSource[] = []
  createAnalyser(): object { return { fftSize: 1024, connect() {}, getFloatTimeDomainData() {} } }
  createBuffer(_channels: number, length: number, rate: number): object {
    const data = new Float32Array(length)
    return { duration: length / rate, getChannelData: () => data }
  }
  createBufferSource(): FakeSource {
    const source = new FakeSource()
    this.sources.push(source)
    return source
  }
  async resume(): Promise<void> { this.state = 'running' }
  advance(to: number): void {
    for (;;) {
      const source = this.sources.filter((s) => !s.ended && !s.stopped && s.end <= to).sort((a, b) => a.end - b.end)[0]
      if (!source) break
      this.currentTime = source.end
      source.ended = true
      source.onended?.()
    }
    this.currentTime = to
  }
}

function harness(): {
  player: SpeechPlayer; ctx: FakeContext; states: PlayerState[];
  calls: { id: string; resolve: () => void; reject: (err: Error) => void }[];
  aborts: string[]; chunk: (id: string, bytes: Uint8Array | null) => void;
  diagnostics: PlaybackDiagnostic[];
} {
  const ctx = new FakeContext()
  const states: PlayerState[] = []
  const calls: { id: string; resolve: () => void; reject: (err: Error) => void }[] = []
  const aborts: string[] = []
  const diagnostics: PlaybackDiagnostic[] = []
  let receive: (id: string, bytes: Uint8Array | null) => void = () => {}
  Object.assign(globalThis, {
    AudioContext: class { constructor() { return ctx } },
    window: { api: {
      onSpeechChunk: (cb: typeof receive) => { receive = cb },
      streamSpeech: (id: string) => new Promise<void>((resolve, reject) => calls.push({ id, resolve, reject })),
      abortSpeech: async (id: string) => { aborts.push(id) }
    } }
  })
  const player = new SpeechPlayer((state) => states.push(state), (event) => diagnostics.push(event))
  return { player, ctx, states, calls, aborts, diagnostics, chunk: (id, bytes) => receive(id, bytes) }
}

const wav = (seconds: number): Uint8Array => encodeWav(new Float32Array(Math.round(seconds * 1000)), 1000)
const settle = async (): Promise<void> => { for (let i = 0; i < 6; i++) await Promise.resolve() }

test('voz lenta: reproduz cada frase inteira sem voltar a waiting entre pedaços', async () => {
  const h = harness()
  h.player.enqueue('Uma frase recebida lentamente.', 'female-portuguese')
  const id = h.calls[0].id
  const bytes = wav(1.28)
  for (let i = 0; i < 8; i++) {
    h.ctx.advance((i + 1) * 0.2)
    h.chunk(id, i === 0 ? bytes.slice(0, 44 + 320) : bytes.slice(44 + i * 320, 44 + (i + 1) * 320))
  }
  h.chunk(id, null)
  assert.equal(h.ctx.sources.length, 0, 'o marcador final não confirma o sucesso da síntese')
  h.calls[0].resolve()
  await settle()
  h.ctx.advance(5)
  assert.deepEqual(h.states, ['waiting', 'playing', 'idle'])
  assert.equal(h.ctx.sources.length, 1, 'a frase deve ser um único buffer contínuo')
  assert.equal(h.ctx.sources[0].buffer?.duration, 1.28)
  assert.deepEqual(h.aborts, [], 'nenhuma transição de estado deve abortar a síntese')
  assert.equal(h.diagnostics.filter((e) => e.event === 'stop').length, 0)
})

test('duas frases prontas tocam em sequência, sem sobreposição nem corte entre elas', async () => {
  const h = harness()
  h.player.enqueue('Primeira frase.', 'female-portuguese')
  h.player.enqueue('Segunda frase.', 'female-portuguese')
  assert.equal(h.calls.length, 1, 'a próxima síntese deve aguardar a requisição atual')
  const first = h.calls[0]
  h.chunk(first.id, wav(1))
  h.chunk(first.id, null)
  first.resolve()
  await settle()
  const second = h.calls[1]
  h.ctx.advance(0.2)
  h.chunk(second.id, wav(0.5))
  h.chunk(second.id, null)
  second.resolve()
  await settle()
  assert.equal(h.ctx.sources.length, 2)
  assert.equal(h.ctx.sources[1].at, h.ctx.sources[0].end)
  h.ctx.advance(3)
  assert.deepEqual(h.states, ['waiting', 'playing', 'idle'])
})

test('stop cancela a síntese em andamento e ignora pedaços atrasados', () => {
  const h = harness()
  h.player.enqueue('Frase interrompida.', 'female-portuguese')
  const id = h.calls[0].id
  h.chunk(id, wav(0.5))
  h.player.stop()
  h.chunk(id, wav(0.5))
  h.chunk(id, null)
  h.ctx.advance(3)
  assert.deepEqual(h.aborts, [id])
  assert.equal(h.states.at(-1), 'idle')
  assert.ok(h.ctx.sources.every((s) => s.stopped))
})

test('o fim do invoke antes do último pedaço não encerra nem trunca a frase', async () => {
  const h = harness()
  h.player.enqueue('Primeira frase.', 'female-portuguese')
  h.player.enqueue('Segunda frase.', 'female-portuguese')
  const first = h.calls[0]
  const bytes = wav(0.5)
  h.chunk(first.id, bytes.slice(0, 244))
  first.resolve()
  await settle()
  assert.equal(h.ctx.sources.length, 0)
  const second = h.calls[1]
  h.chunk(second.id, wav(0.25))
  h.chunk(second.id, null)
  second.resolve()
  await settle()
  assert.equal(h.ctx.sources.length, 0, 'uma frase posterior não pode ultrapassar a anterior')
  h.chunk(first.id, bytes.slice(244))
  h.chunk(first.id, null)
  assert.deepEqual(h.ctx.sources.map((s) => s.buffer?.duration), [0.5, 0.25])
  assert.equal(h.ctx.sources[1].at, h.ctx.sources[0].end)
})

test('cancelar durante a reprodução para as fontes e descarta a fila', async () => {
  const h = harness()
  h.player.enqueue('Frase tocando.', 'female-portuguese')
  h.player.enqueue('Frase ainda não solicitada.', 'female-portuguese')
  h.player.enqueue('Outra frase na fila.', 'female-portuguese')
  const first = h.calls[0]
  h.chunk(first.id, wav(2))
  h.chunk(first.id, null)
  first.resolve()
  await settle()
  h.ctx.advance(0.2)
  h.player.stop('microphone')
  assert.equal(h.ctx.sources.length, 1)
  assert.equal(h.ctx.sources[0].stopped, true)
  assert.equal(h.calls.length, 2)
  assert.deepEqual(h.aborts, [h.calls[1].id])
  assert.equal(h.states.at(-1), 'idle')
  assert.equal(h.diagnostics.find((e) => e.event === 'stop')?.reason, 'microphone')
})

test('finalização antiga não interfere na geração da nova resposta', async () => {
  const h = harness()
  h.player.enqueue('Resposta antiga.', 'female-portuguese')
  h.player.enqueue('Fila antiga.', 'female-portuguese')
  const old = h.calls[0]
  h.player.stop('new-reply')
  h.player.enqueue('Resposta nova.', 'female-portuguese')
  h.player.enqueue('Próxima frase nova.', 'female-portuguese')
  old.resolve()
  await settle()
  assert.equal(h.calls.length, 2, 'finalização antiga não deve liberar outra síntese concorrente')
  h.chunk(old.id, wav(1))
  h.chunk(old.id, null)
  assert.equal(h.ctx.sources.length, 0)
  h.chunk(h.calls[1].id, wav(0.5))
  h.chunk(h.calls[1].id, null)
  h.calls[1].resolve()
  await settle()
  assert.equal(h.calls.length, 3)
  assert.equal(h.ctx.sources.length, 1)
  assert.deepEqual(h.aborts, [old.id])
})

test('falha de IPC sem marcador final libera a fila', async (t) => {
  const errors = t.mock.method(console, 'error', () => {})
  const h = harness()
  h.player.enqueue('Frase que falha.', 'female-portuguese')
  h.player.enqueue('Frase seguinte.', 'female-portuguese')
  h.calls[0].reject(new Error('Falha sintética de IPC'))
  await settle()
  assert.equal(h.calls.length, 2)
  const next = h.calls[1]
  h.chunk(next.id, wav(0.25))
  h.chunk(next.id, null)
  next.resolve()
  await settle()
  h.ctx.advance(1)
  assert.equal(h.states.at(-1), 'idle')
  assert.equal(h.diagnostics.filter((e) => e.event === 'error').length, 1)
  assert.equal(errors.mock.callCount(), 1)
})

test('resposta sem amostras termina sem criar uma fonte de duração zero', async () => {
  const h = harness()
  h.player.enqueue('Sem áudio.', 'female-portuguese')
  h.chunk(h.calls[0].id, null)
  h.calls[0].resolve()
  await settle()
  assert.equal(h.ctx.sources.length, 0)
  assert.deepEqual(h.states, ['waiting', 'idle'])
})

test('play só confirma o início após receber o áudio inteiro e o sucesso do IPC', async () => {
  const h = harness()
  const playing = h.player.play('Resposta completa, com várias frases.', 'female-portuguese')
  let confirmed = false
  void playing.then(() => { confirmed = true })
  const call = h.calls[0]
  h.chunk(call.id, wav(1))
  h.chunk(call.id, null)
  await settle()
  assert.equal(confirmed, false)
  assert.equal(h.ctx.sources.length, 0)
  call.resolve()
  assert.equal(await playing, true)
  assert.equal(h.ctx.sources.length, 1)
  assert.equal(h.states.at(-1), 'playing')
})

test('play cancela a espera sem tocar ou rejeitar quando a resposta é interrompida', async () => {
  const h = harness()
  const playing = h.player.play('Resposta cancelada.', 'female-portuguese')
  const call = h.calls[0]
  h.chunk(call.id, wav(0.5))
  h.chunk(call.id, null)
  h.player.stop('escape')
  assert.equal(await playing, false)
  assert.deepEqual(h.aborts, [call.id])
  call.resolve()
  await settle()
  assert.equal(h.ctx.sources.length, 0)
  assert.equal(h.states.at(-1), 'idle')
})

test('erro de síntese após o marcador final não apresenta áudio parcial', async (t) => {
  t.mock.method(console, 'error', () => {})
  const h = harness()
  const playing = h.player.play('Resposta com falha na síntese.', 'female-portuguese')
  const rejected = assert.rejects(playing, /Falha de síntese/)
  const call = h.calls[0]
  h.chunk(call.id, wav(0.5))
  h.chunk(call.id, null)
  call.reject(new Error('Falha de síntese'))
  await rejected
  assert.equal(h.ctx.sources.length, 0)
  assert.equal(h.states.at(-1), 'idle')
})
