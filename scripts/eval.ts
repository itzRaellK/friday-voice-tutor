// Mede os prompts da Friday contra os casos de eval-cases.ts, usando as mesmas funções do app.
//   npm run eval                 → modelo padrão (friday-brain)
//   npm run eval -- qwen3.5:4b   → outro modelo
// As checagens de idioma usam o detector estatístico do app, então não dependem do modelo testado.

import { findLanguage, type Language } from '../src/renderer/src/lib/languages'
import { whichLanguage, writtenIn } from '../src/renderer/src/lib/languageId'
import { replyReminder, tutorPrompt } from '../src/renderer/src/lib/prompt'
import { reviewSentence, translateReply } from '../src/renderer/src/lib/review'
import { CORRECTION, DETECT, REPLY } from './eval-cases'

const OLLAMA = process.env.OLLAMA_HOST ? `http://${process.env.OLLAMA_HOST.replace(/^https?:\/\//, '')}` : 'http://127.0.0.1:11434'
const MODEL = process.argv[2] ?? 'friday-brain'
const verbose = process.env.VERBOSE === '1'

type Msg = { role: 'system' | 'user' | 'assistant'; content: string }

async function chat(messages: Msg[], opts: { format?: object; temperature?: number } = {}): Promise<{ text: string; ms: number }> {
  const t = Date.now()
  const res = await fetch(`${OLLAMA}/api/chat`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      model: MODEL,
      messages,
      format: opts.format,
      stream: false,
      think: false,
      keep_alive: '10m',
      options: { temperature: opts.temperature ?? 0, num_ctx: 8192 }
    })
  })
  if (!res.ok) throw new Error(`${MODEL}: ${res.status} ${await res.text()}`)
  const data = (await res.json()) as { message: { content: string } }
  return { text: data.message.content, ms: Date.now() - t }
}

const lang = (code: string): Language => findLanguage(code)!
const pct = (n: number, d: number): string => (d ? `${Math.round((n / d) * 100)}%` : '—')
const avg = (xs: number[]): string => (xs.length ? `${Math.round(xs.reduce((a, b) => a + b, 0) / xs.length)} ms` : '—')

async function main(): Promise<void> {
  console.log(`Modelo: ${MODEL}\n`)

  // 1. Em que língua o aluno escreveu (detector estatístico: não depende do modelo)
  let detectOk = 0
  for (const c of DETECT) {
    const got = whichLanguage(c.text, lang(c.usage), lang(c.study))
    if (got === c.expect) detectOk++
    else console.log(`  ✗ idioma [${c.usage}→${c.study}] "${c.text}": esperado ${c.expect}, veio ${got}`)
  }

  // 2. Correções
  let caught = 0, errors = 0, falseAlarms = 0, clean = 0, explainedRight = 0, explained = 0
  const fixMs: number[] = []
  for (const c of CORRECTION) {
    const usage = lang(c.usage), study = lang(c.study)
    // Mesmo caminho do app: revisão + nova tentativa se a explicação vier na língua errada.
    const t = Date.now()
    const fix = await reviewSentence(async (m, format) => (await chat(m, { format })).text, usage, study, c.text)
    fixMs.push(Date.now() - t)
    if (c.hasError) {
      errors++
      if (fix) caught++
      else console.log(`  ✗ não pegou [${c.usage}→${c.study}] "${c.text}"`)
    } else {
      clean++
      if (fix) {
        falseAlarms++
        console.log(`  ✗ alarme falso [${c.usage}→${c.study}] "${c.text}" → ${fix.corrected}`)
      }
    }
    if (fix?.explanation) {
      explained++
      if (writtenIn(fix.explanation, usage, study)) explainedRight++
      else console.log(`  ✗ explicação fora da língua do aluno [${c.usage}→${c.study}]: "${fix.explanation}"`)
    }
    if (verbose && fix) console.log(`    [${c.usage}→${c.study}] ${fix.corrected} — ${fix.explanation}`)
  }

  // 3. Respostas: a fala sai na língua de estudo e a tradução na língua do aluno
  let replyLang = 0, translated = 0
  const replyMs: number[] = [], translateMs: number[] = []
  for (const c of REPLY) {
    const usage = lang(c.usage), study = lang(c.study)
    const r = await chat(
      [
        { role: 'system', content: tutorPrompt(usage, study) },
        { role: 'user', content: c.text },
        { role: 'system', content: replyReminder(study) }
      ],
      { temperature: 0.7 }
    )
    replyMs.push(r.ms)
    const inStudy = writtenIn(r.text, study, usage)
    if (inStudy) replyLang++
    const t = Date.now()
    const translation = await translateReply(async (m, format) => (await chat(m, { format })).text, r.text, usage, study)
    translateMs.push(Date.now() - t)
    if (translation) translated++
    if (!inStudy || !translation || verbose) {
      console.log(`  ${inStudy && translation ? '·' : '✗'} resposta [${c.usage}→${c.study}] "${c.text}"`)
      console.log(`      fala: ${r.text.replace(/\n/g, ' ')}`)
      console.log(`      tradução: ${translation || '(nenhuma)'}`)
    }
  }

  console.log(`
Idioma da mensagem   ${detectOk}/${DETECT.length} (${pct(detectOk, DETECT.length)})
Erros pegos          ${caught}/${errors} (${pct(caught, errors)})
Alarmes falsos       ${falseAlarms}/${clean} (${pct(falseAlarms, clean)})
Explicação no idioma ${explainedRight}/${explained} (${pct(explainedRight, explained)}) · correção ${avg(fixMs)}
Fala na língua de estudo ${replyLang}/${REPLY.length} · ${avg(replyMs)}
Tradução na língua do aluno ${translated}/${REPLY.length} · ${avg(translateMs)}`)
}

main().catch((err) => {
  console.error(err)
  process.exit(1)
})
