import { mkdir, writeFile } from 'node:fs/promises'
import { cpus, freemem, totalmem } from 'node:os'
import { join } from 'node:path'
import { OLLAMA_URL } from '../src/main/ollama'
import { WavStreamDecoder } from '../src/renderer/src/audio/wav'
import { findLanguage } from '../src/renderer/src/lib/languages'
import { correctionMessages, CORRECTION_SCHEMA, tutorPrompt, replyReminder } from '../src/renderer/src/lib/prompt'

// Usa frases sintéticas, sem gravar microfone nem alterar modelos ou configurações do Ollama.
const brain = process.env.FRIDAY_DIAG_BRAIN ?? 'friday-brain'
const voice = process.env.FRIDAY_DIAG_VOICE ?? 'friday-voice'
const speaker = process.env.FRIDAY_DIAG_SPEAKER ?? 'female-american-english'
const text = 'Hello! Today we can practice a short conversation together. Tell me about something you enjoy doing in your free time.'
const round = (n: number): number => Math.round(n * 1000) / 1000

async function post(path: string, body: object): Promise<Response> {
  const res = await fetch(`${OLLAMA_URL}${path}`, {
    method: 'POST', headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(body), signal: AbortSignal.timeout(90_000)
  })
  if (!res.ok) throw new Error(`${path}: ${res.status} ${await res.text()}`)
  return res
}

async function speech(label: string, input = text): Promise<object> {
  const start = performance.now()
  const res = await post('/v1/audio/speech', { model: voice, input, voice: speaker })
  if (!res.body) throw new Error('Resposta de voz sem corpo')
  const decoder = new WavStreamDecoder()
  const arrivals: { at: number; audio: number }[] = []
  for await (const bytes of res.body as unknown as AsyncIterable<Uint8Array>) {
    const samples = decoder.push(bytes)
    if (samples.length) arrivals.push({ at: (performance.now() - start) / 1000, audio: samples.length / decoder.sampleRate })
  }
  const total = (performance.now() - start) / 1000
  if (!arrivals.length) throw new Error('O modelo não devolveu amostras de áudio')
  const audio = arrivals.reduce((sum, c) => sum + c.audio, 0)

  // Mantém a simulação do player anterior para comparar os cortes com o modo de frases completas.
  let pending = 0
  let started = false
  let scheduledUntil = 0
  let firstPlayback = 0
  const gaps: number[] = []
  function schedule(now: number): void {
    const at = Math.max(scheduledUntil, now + 0.03)
    if (scheduledUntil) gaps.push(Math.max(0, at - scheduledUntil))
    else firstPlayback = at
    scheduledUntil = at + pending
    pending = 0
  }
  for (const chunk of arrivals) {
    pending += chunk.audio
    if (!started && pending >= 0.3) started = true
    if (started && pending >= 0.1) schedule(chunk.at)
  }
  if (pending) schedule(total)
  const result = {
    label, firstAudioS: round(arrivals[0].at), totalS: round(total), audioS: round(audio),
    realTimeFactor: round(total / audio), playbackMode: 'complete-response', firstPlaybackS: round(total + 0.03),
    simulatedGapsInsideSentence: 0,
    legacyStreaming: {
      firstPlaybackS: round(firstPlayback),
      simulatedGapsOver50ms: gaps.filter((s) => s > 0.05).length,
      simulatedGapTotalS: round(gaps.reduce((sum, s) => sum + s, 0)),
      largestSimulatedGapS: round(Math.max(0, ...gaps))
    },
    sampleRate: decoder.sampleRate, chunks: arrivals.length
  }
  console.log(JSON.stringify(result))
  return result
}

async function chat(label: string, review = false): Promise<object> {
  const native = findLanguage('pt')!
  const study = findLanguage('en')!
  const start = performance.now()
  const res = await post('/api/chat', {
    model: brain, stream: true, think: false, keep_alive: '30m',
    messages: review ? correctionMessages(native, study, 'Yesterday I go to the park with my friends.') : [
      { role: 'system', content: tutorPrompt(native, study) },
      { role: 'user', content: 'Tell me about some interesting hobbies we could try this weekend.' },
      { role: 'system', content: replyReminder(study) }
    ],
    ...(review ? { format: CORRECTION_SCHEMA } : {}),
    options: { temperature: 0, num_predict: 100 }
  })
  if (!res.body) throw new Error('Resposta de chat sem corpo')
  const decoder = new TextDecoder()
  let buffer = ''
  let firstToken: number | undefined
  let stats: Record<string, number> = {}
  for await (const bytes of res.body as unknown as AsyncIterable<Uint8Array>) {
    buffer += decoder.decode(bytes, { stream: true })
    let nl: number
    while ((nl = buffer.indexOf('\n')) >= 0) {
      const line = buffer.slice(0, nl).trim()
      buffer = buffer.slice(nl + 1)
      if (!line) continue
      const data = JSON.parse(line)
      if (data.error) throw new Error(data.error)
      if (data.message?.content && firstToken === undefined) firstToken = (performance.now() - start) / 1000
      if (data.done) stats = data
    }
  }
  const result = {
    label, totalS: round((performance.now() - start) / 1000), firstTokenS: firstToken === undefined ? null : round(firstToken),
    loadS: round((stats.load_duration ?? 0) / 1e9),
    promptS: round((stats.prompt_eval_duration ?? 0) / 1e9),
    tokens: stats.eval_count, tokensPerS: stats.eval_duration ? round(stats.eval_count / stats.eval_duration * 1e9) : null
  }
  console.log(JSON.stringify(result))
  return result
}

async function main(): Promise<void> {
  const metadata = {
    timestamp: new Date().toISOString(), url: OLLAMA_URL, brain, voice, speaker,
    cpu: cpus()[0]?.model, threads: cpus().length,
    ramGB: round(totalmem() / 2 ** 30), freeRamGB: round(freemem() / 2 ** 30),
    version: await (await fetch(`${OLLAMA_URL}/api/version`, { signal: AbortSignal.timeout(10_000) })).json(),
    loadedBefore: await (await fetch(`${OLLAMA_URL}/api/ps`, { signal: AbortSignal.timeout(10_000) })).json()
  }
  console.log('Diagnóstico local: voz isolada, chat e voz com chamadas concorrentes. Evite conversar no app durante a medição.')
  console.log(JSON.stringify(metadata))
  const measurements: object[] = []
  measurements.push(await speech('warmup', 'Hello!'))
  measurements.push(await speech('voice-alone-1'))
  measurements.push(await speech('voice-alone-2'))
  measurements.push(await chat('chat-alone'))
  const concurrent = await Promise.allSettled([
    speech('voice-with-chat'), chat('chat-with-voice'), chat('review-with-voice', true)
  ])
  for (const result of concurrent) {
    if (result.status === 'rejected') throw result.reason
    measurements.push(result.value)
  }
  const burst = await Promise.allSettled([
    speech('burst-1', 'Hello! Today we can practice a short conversation together.'),
    speech('burst-2', 'Tell me about something you enjoy doing in your free time.'),
    speech('burst-3', 'What would you like to learn next?')
  ])
  for (const result of burst) {
    if (result.status === 'rejected') throw result.reason
    measurements.push(result.value)
  }
  const dir = join('out', 'diagnostics')
  await mkdir(dir, { recursive: true })
  const file = join(dir, 'voice-latest.json')
  await writeFile(file, JSON.stringify({ ...metadata, measurements }, null, 2) + '\n')
  console.log(`Relatório salvo em ${file}. RTF > 1 indica que a requisição demorou mais que a duração do áudio (inclui fila e carregamento); as pausas são estimativas, sem medir a reprodução no Electron.`)
}

main().catch((err) => { console.error(err); process.exitCode = 1 })
