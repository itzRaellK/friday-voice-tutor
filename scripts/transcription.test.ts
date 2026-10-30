import assert from 'node:assert/strict'
import { test } from 'node:test'
import { appendTranscript, splitTranscriptionAudio, transcribeAudio } from '../src/main/transcription'
import { encodeWav } from '../src/renderer/src/audio/wav'
import { transcribe } from '../src/main/ollama'

const RATE = 16000
const audio = (seconds: number): Uint8Array => encodeWav(new Float32Array(seconds * RATE).fill(0.1), RATE)
const duration = (wav: Uint8Array): number => (wav.length - 44) / (RATE * 2)

test('áudio curto mantém todas as amostras em uma única requisição', () => {
  const wav = audio(5)
  const chunks = [...splitTranscriptionAudio(wav)]
  assert.equal(chunks.length, 1)
  assert.equal(chunks[0].overlapsPrevious, false)
  assert.deepEqual(chunks[0].wav, wav)
})

test('70 segundos viram trechos abaixo de 30 segundos, cobrindo todo o áudio', () => {
  const wav = audio(70)
  const chunks = [...splitTranscriptionAudio(wav)]
  assert.deepEqual(chunks.map((c) => duration(c.wav)), [28, 28, 15.5])
  assert.deepEqual(chunks.map((c) => c.overlapsPrevious), [false, true, true])
  let offset = 0
  for (const chunk of chunks) {
    if (chunk.overlapsPrevious) offset -= 0.75 * RATE * 2
    const pcm = chunk.wav.subarray(44)
    assert.deepEqual(pcm, wav.subarray(44 + offset, 44 + offset + pcm.length))
    assert.equal(new DataView(chunk.wav.buffer).getUint32(4, true), chunk.wav.length - 8)
    offset += pcm.length
  }
  assert.equal(offset, wav.length - 44, 'nenhuma amostra pode ser perdida na divisão')
})

test('uma pausa perto da borda é preferida para não dividir uma palavra', () => {
  const samples = new Float32Array(40 * RATE).fill(0.1)
  samples.fill(0, 25 * RATE, 25.4 * RATE)
  const chunks = [...splitTranscriptionAudio(encodeWav(samples, RATE))]
  const boundary = duration(chunks[0].wav)
  assert.ok(boundary >= 25 && boundary <= 25.4)
  assert.equal(chunks[1].overlapsPrevious, false)
  assert.equal(chunks.reduce((sum, c) => sum + duration(c.wav), 0), 40)
})

test('rejeita formato incorreto e WAV truncado em vez de enviar áudio inválido', () => {
  assert.throws(() => [...splitTranscriptionAudio(new Uint8Array(4))], /WAV PCM/)
  const wav = audio(2)
  assert.throws(() => [...splitTranscriptionAudio(wav.subarray(0, 100))], /WAV PCM/)
  assert.throws(() => [...splitTranscriptionAudio(encodeWav(new Float32Array(8000), 8000))], /16 kHz/)
})

test('junção remove repetição na sobreposição e preserva repetições fora dela', () => {
  assert.equal(appendTranscript('Eu fui ao parque ontem.', 'PARQUE ontem, e encontrei amigos.', true), 'Eu fui ao parque ontem. e encontrei amigos.')
  assert.equal(appendTranscript('Muito bem', 'muito bem mesmo.', false), 'Muito bem muito bem mesmo.')
  assert.equal(appendTranscript('Olá.', '', true), 'Olá.')
  assert.equal(appendTranscript('', 'Olá.', false), 'Olá.')
  assert.equal(appendTranscript('今天我们学习法语', '我们学习法语然后练习发音', true), '今天我们学习法语然后练习发音')
})

test('transcrição longa é sequencial e só entrega uma mensagem depois de todos os trechos', async () => {
  let calls = 0
  let active = 0
  let delivered = false
  const pieces = ['Eu fui ao parque ontem', 'parque ontem e encontrei amigos', 'encontrei amigos da escola.']
  const result = transcribeAudio(audio(70), async (wav) => {
    assert.ok(duration(wav) < 30)
    active++
    assert.equal(active, 1)
    assert.equal(delivered, false)
    const text = pieces[calls++]
    await Promise.resolve()
    active--
    return text
  }).then((text) => { delivered = true; return text })
  assert.equal(await result, 'Eu fui ao parque ontem e encontrei amigos da escola.')
  assert.equal(calls, 3)
})

test('falha em um trecho interrompe a transcrição sem retornar uma mensagem parcial', async () => {
  let calls = 0
  await assert.rejects(transcribeAudio(audio(70), async () => {
    if (++calls === 2) throw new Error('Falha no segundo trecho')
    return 'Texto parcial que não pode disparar uma resposta.'
  }), /Falha no segundo trecho/)
  assert.equal(calls, 2)
})

test('cliente Ollama envia trechos WAV válidos em sequência e devolve uma única transcrição', async (t) => {
  const durations: number[] = []
  const pieces = ['Eu fui ao parque ontem', 'parque ontem e encontrei amigos', 'encontrei amigos da escola.']
  t.mock.method(globalThis, 'fetch', async (url: RequestInfo | URL, init?: RequestInit) => {
    assert.ok(String(url).endsWith('/v1/audio/transcriptions'))
    const form = init?.body as FormData
    assert.ok(form.get('model'))
    const file = form.get('file') as Blob
    assert.equal(file.type, 'audio/wav')
    const wav = new Uint8Array(await file.arrayBuffer())
    durations.push(duration(wav))
    return new Response(JSON.stringify({ text: pieces[durations.length - 1] }), { status: 200 })
  })
  assert.equal(await transcribe(audio(70)), 'Eu fui ao parque ontem e encontrei amigos da escola.')
  assert.deepEqual(durations, [28, 28, 15.5])
})
