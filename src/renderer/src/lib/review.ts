import type { ChatMessage } from '../../../preload'
import type { Language } from './languages'
import { writtenIn } from './languageId'
import { CORRECTION_SCHEMA, correctionMessages, explainMessages, parseCorrection, translateMessages, type Correction } from './prompt'

const withoutQuotes = (s: string): string => s.replace(/"[^"]*"|“[^”]*”|«[^»]*»/g, ' ')

export type Complete = (messages: ChatMessage[], format?: object) => Promise<string>

/**
 * Revisa a frase do aluno. Se a explicação vier vazia ou fora da língua dele, pede de novo com um lembrete;
 * se ainda vier errada, pergunta só a explicação; se nem assim, mostra só a frase corrigida.
 * Vale igual para qualquer idioma.
 */
export async function reviewSentence(complete: Complete, usage: Language, study: Language, sentence: string): Promise<Correction | undefined> {
  const first = parseCorrection(await complete(correctionMessages(usage, study, sentence), CORRECTION_SCHEMA))
  if (!first) return undefined
  // Sem explicação conta como explicação ruim: a correção sozinha ensina pouco.
  if (first.explanation && writtenIn(first.explanation, usage, study)) return first
  const second = parseCorrection(await complete(correctionMessages(usage, study, sentence, true), CORRECTION_SCHEMA))
  if (second?.explanation && writtenIn(second.explanation, usage, study)) return second
  const best = second ?? first
  // Uma pergunta direta ("por que A virou B?") sai na língua certa bem mais vezes que traduzir a
  // explicação: o tradutor tende a devolver intacto um texto cheio de palavras entre aspas.
  const explanation = (await complete(explainMessages(usage, sentence, best.corrected))).trim()
  return { corrected: best.corrected, explanation: writtenIn(withoutQuotes(explanation), usage, study, true) ? explanation : '' }
}

/**
 * Tradução da fala da Friday para a língua do aluno, conferida pelo detector: se vier na língua
 * errada, tenta de novo uma vez; se ainda assim falhar, a tela fica só com a fala original.
 */
export async function translateReply(complete: Complete, text: string, usage: Language, study: Language): Promise<string> {
  for (let attempt = 0; attempt < 2; attempt++) {
    const translated = (await complete(translateMessages(text, usage))).trim()
    // O que está entre aspas fica na língua de estudo de propósito; a conferência olha o resto.
    if (translated && translated !== text.trim() && writtenIn(withoutQuotes(translated), usage, study, true)) return translated
  }
  return ''
}
