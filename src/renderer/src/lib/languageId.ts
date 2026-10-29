import { eld } from 'eld/medium'
import type { Language } from './languages'

// Detector estatístico de idioma (n-gramas): determinístico, instantâneo e igual para qualquer língua.
// Restrito às duas línguas do aluno, ele acerta até frases curtas como "Oui, merci." ou "Sim.".
// Um LLM pequeno errava muito aqui ("Como se diz bom dia em francês?" virava francês).

export type Which = 'usage' | 'study' | 'unknown'

const iso = (l: Language): string => l.code.split('-')[0]

export function whichLanguage(text: string, usage: Language, study: Language): Which {
  if (iso(usage) === iso(study)) return 'study'
  eld.setLanguageSubset([iso(usage), iso(study)])
  const found = eld.detect(text).language
  if (found === iso(study)) return 'study'
  if (found === iso(usage)) return 'usage'
  return 'unknown' // "ok", "hm", emojis: sem pista suficiente
}

/**
 * O texto está na língua esperada? `allowUnknown` aceita textos curtos demais para ter pista
 * ("Olá. Repita."), rejeitando só o que for claramente de outra língua. O inglês entra na comparação porque é para onde
 * os modelos mais escorregam quando não seguem a instrução de idioma.
 */
export function writtenIn(text: string, expected: Language, study: Language, allowUnknown = false): boolean {
  const candidates = [...new Set([iso(expected), iso(study), 'en'])]
  eld.setLanguageSubset(candidates)
  const found = eld.detect(text).language
  return found === iso(expected) || (allowUnknown && found === '')
}
