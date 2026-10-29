import type { ChatMessage } from '../../../preload'
import type { Language } from './languages'

// Dois idiomas: `usage` é o do aluno e `study` é o que ele estuda. A Friday fala sempre na língua de
// estudo (é o que se ouve e o que aparece em destaque); a tela mostra embaixo a tradução na língua
// do aluno. A tradução é uma chamada à parte, feita depois da resposta, para não atrasar a voz.
// Tudo aqui é igual para qualquer par de idiomas: nenhuma regra é escrita para uma língua específica.

const NAMES = 'Friday, Sexta-feira, Sexta, Vendredi, Viernes, Freitag or Venerdì'

export function tutorPrompt(usage: Language, study: Language): string {
  return `You are Friday, a warm and witty language tutor. The student may call you ${NAMES}: all of these are your name.
Your student speaks ${usage.english} and is learning ${study.english}. Everything you say is spoken aloud in ${study.english}, and a ${usage.english} translation appears on screen for the student.
- Always reply in ${study.english}, even when the student writes in ${usage.english} or asks how to say something. Never write ${usage.english}; the translation is added separately.
- Use simple, clear ${study.english}: 1 to 3 short sentences. When the student asks how to say something, say it and invite them to repeat it.
- Put anything the student should say or repeat in double quotes, like "…", so it stays in ${study.english} in the translation.
- If the student asks about a correction they were shown, explain it simply in ${study.english}, quoting the corrected words.
- Usually end with a question or a small challenge that keeps the conversation going.
- Do not correct the student's mistakes; another system shows the corrections. Just use the correct forms yourself.
- Plain text only: no markdown, no lists, no emojis.`
}

/** Lembrete que vai depois do histórico: pesa mais que o prompt inicial quando o histórico mistura línguas. */
export const replyReminder = (study: Language): string => `Reply only in ${study.english}.`

export const greetingPrompt = (study: Language): string =>
  `*The student just opened the app. Greet them in ${study.english} in one short sentence and ask what they want to talk about.*`

/** Tradução da fala da Friday para a língua do aluno; também serve de reserva para explicações. */
export function translateMessages(text: string, to: Language): ChatMessage[] {
  return [
    {
      role: 'system',
      content: `Translate the text into ${to.english}. Keep words or sentences the student is meant to say or repeat (usually in quotes) in their original language. Answer only with the translation.`
    },
    { role: 'user', content: text }
  ]
}

// ---- revisão da frase do aluno ----

export const CORRECTION_SCHEMA = {
  type: 'object',
  properties: {
    has_error: { type: 'boolean' },
    corrected: { type: 'string' },
    explanation: { type: 'string' }
  },
  required: ['has_error', 'corrected', 'explanation']
}

export function correctionMessages(usage: Language, study: Language, sentence: string, insist = false): ChatMessage[] {
  const messages: ChatMessage[] = [
    {
      role: 'system',
      content: `You review a sentence written in ${study.english} by a student whose own language is ${usage.english}.
Set has_error to true only for real grammar, vocabulary or word-order mistakes. Ignore missing accents, capitalization and punctuation. Names (Friday, Sexta-feira, Sexta) are always correct.
If has_error is true: "corrected" is the full corrected sentence in ${study.english}, and "explanation" says in a few words why, written in ${usage.english} (the student's language), never in ${study.english}.
If has_error is false: leave "corrected" and "explanation" empty.`
    },
    { role: 'user', content: sentence }
  ]
  if (insist) messages.push({ role: 'system', content: `The explanation MUST be written in ${usage.english}.` })
  return messages
}

/** Quando a revisão acerta a correção mas não explica: uma pergunta direta, mais fácil para o modelo. */
export function explainMessages(usage: Language, original: string, corrected: string): ChatMessage[] {
  return [
    {
      role: 'system',
      content: `In ${usage.english}, explain in one short sentence why the first sentence was corrected to the second. Answer only with the explanation, written in ${usage.english}.`
    },
    { role: 'user', content: `1. ${original}
2. ${corrected}` }
  ]
}

export interface Correction {
  corrected: string
  explanation: string
}

export function parseCorrection(raw: string): Correction | undefined {
  try {
    const v = JSON.parse(raw) as { has_error?: boolean; corrected?: string; explanation?: string }
    const corrected = v.corrected?.trim() ?? ''
    if (!v.has_error || !corrected) return undefined
    return { corrected, explanation: v.explanation?.trim() ?? '' }
  } catch {
    return undefined
  }
}

export const formatCorrection = (c: Correction): string => (c.explanation ? `“${c.corrected}” — ${c.explanation}` : `“${c.corrected}”`)
