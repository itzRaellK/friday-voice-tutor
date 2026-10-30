import assert from 'node:assert/strict'
import { test } from 'node:test'
import { Listener } from '../src/renderer/src/audio/listener'

const RATE = 48000
const FRAME = 2048

async function listenerHarness(): Promise<{
  listener: Listener; feed: (frames: number, volume?: number) => void;
  events: { starts: number; ends: number; utterances: Uint8Array[] };
}> {
  const events = { starts: 0, ends: 0, utterances: [] as Uint8Array[] }
  const node = { onaudioprocess: null as null | ((event: { inputBuffer: { getChannelData: () => Float32Array } }) => void), connect() {}, disconnect() {} }
  Object.assign(globalThis, {
    AudioContext: class {
      sampleRate = RATE
      destination = {}
      createMediaStreamSource(): object { return { connect() {} } }
      createScriptProcessor(): typeof node { return node }
      async close(): Promise<void> {}
    },
    OfflineAudioContext: class {
      destination = {}
      constructor(_channels: number, private frames: number) {}
      createBuffer(): object { return { copyToChannel() {} } }
      createBufferSource(): object { return { connect() {}, start() {} } }
      async startRendering(): Promise<object> { return { getChannelData: () => new Float32Array(this.frames) } }
    }
  })
  Object.defineProperty(globalThis, 'navigator', { configurable: true, value: {
    mediaDevices: { getUserMedia: async () => ({ getTracks: () => [{ stop() {} }] }) }
  } })
  const listener = new Listener({
    onSpeechStart: () => { events.starts++ }, onSpeechEnd: () => { events.ends++ },
    onUtterance: (wav) => events.utterances.push(wav), onBargeIn: () => {}
  })
  await listener.start()
  return {
    listener, events,
    feed: (frames, volume = 0.1) => {
      const data = new Float32Array(FRAME).fill(volume)
      for (let i = 0; i < frames; i++) node.onaudioprocess?.({ inputBuffer: { getChannelData: () => data } })
    }
  }
}

const settleCapture = async (): Promise<void> => { for (let i = 0; i < 5; i++) await Promise.resolve() }

test('captura encerra somente após 3 segundos de silêncio', async () => {
  const h = await listenerHarness()
  h.feed(30)
  h.feed(70, 0) // 2,987 s: ainda não encerra
  assert.equal(h.events.ends, 0)
  assert.equal(h.events.utterances.length, 0)
  h.feed(1, 0) // 3,029 s: primeiro quadro que ultrapassa 3 s
  await settleCapture()
  assert.equal(h.events.ends, 1)
  assert.equal(h.events.utterances.length, 1)
  h.listener.stop()
})

test('fala contínua de 3 minutos não dispara cortes nem respostas intermediárias', async () => {
  const h = await listenerHarness()
  h.feed(Math.ceil(180 * RATE / FRAME))
  assert.equal(h.events.starts, 1)
  assert.equal(h.events.ends, 0)
  assert.equal(h.events.utterances.length, 0)
  h.feed(71, 0)
  await settleCapture()
  assert.equal(h.events.ends, 1)
  assert.equal(h.events.utterances.length, 1)
  const wav = h.events.utterances[0]
  const seconds = new DataView(wav.buffer).getUint32(40, true) / (16000 * 2)
  assert.ok(seconds > 182, 'a captura deve manter também o início da fala longa')
  h.listener.stop()
})

test('pausas de 2,5 segundos no meio da construção mantêm uma única fala', async () => {
  const h = await listenerHarness()
  for (let i = 0; i < 8; i++) {
    h.feed(48)
    h.feed(59, 0)
  }
  assert.equal(h.events.starts, 1)
  assert.equal(h.events.ends, 0)
  h.feed(12, 0)
  await settleCapture()
  assert.equal(h.events.utterances.length, 1)
  h.listener.stop()
})

test('silenciar o microfone descarta a captura longa em andamento', async () => {
  const h = await listenerHarness()
  h.feed(500)
  h.listener.paused = true
  h.feed(1)
  await settleCapture()
  assert.equal(h.events.ends, 1)
  assert.equal(h.events.utterances.length, 0)
  h.listener.stop()
})
