// Detecta se a fala transcrita chama a Friday. O nome só conta no começo da frase, depois no
// máximo de "ei"/"oi" ("Friday, …", "Ei, Sexta-feira …"), para "na sexta eu vou…" não acordá-la.

const LEADING_FILLERS = new Set(['ei', 'hey', 'hei', 'oi', 'ola', 'hi', 'hello', 'ok', 'okay', 'e', 'ai', 'alo'])
// Grafias que a transcrição costuma produzir para "Friday".
const NAMES = /^(friday|fridays|fraide|fraidei|fraidey|fryday|freiday|sexta(?:feira)?|vendredi|viernes|freitag|venerdi)$/

const normalize = (s: string): string =>
  s
    .toLowerCase()
    .normalize('NFD')
    .replace(/\p{M}/gu, '')

export interface WakeResult {
  /** O texto que vem depois do nome, sem pontuação inicial; vazio se ela só foi chamada. */
  rest: string
}

export function detectWake(text: string): WakeResult | undefined {
  // Divide preservando o texto original, para devolver o resto com acentos e maiúsculas.
  const words = [...text.matchAll(/[\p{L}\p{N}'’-]+/gu)]
  let i = 0
  while (i < words.length && i < 2 && LEADING_FILLERS.has(normalize(words[i][0]))) i++
  if (i >= words.length) return undefined
  let word = normalize(words[i][0]).replace(/[-'’]/g, '')
  let last = i
  // "Sexta feira" separado em duas palavras
  if (word === 'sexta' && words[i + 1] && normalize(words[i + 1][0]) === 'feira') {
    word = 'sextafeira'
    last = i + 1
  }
  if (!NAMES.test(word)) return undefined
  const end = words[last].index! + words[last][0].length
  return { rest: text.slice(end).replace(/^[\s,.!?;:—–-]+/, '').trim() }
}

// Despedidas que encerram a conversa. Só valem em falas curtas, para "eu disse tchau pro meu chefe
// ontem" continuar sendo conversa. Agradecer só encerra junto com o nome ("obrigado, Friday").
const FAREWELLS = /\b(tchau|chau|ate logo|ate mais|ate amanha|falou|bye|goodbye|see you|adios|hasta luego|au revoir|a bientot|tschuss|ciao|arrivederci|encerrar|pode parar)\b/
const THANKS = /\b(obrigad[oa]|valeu|thanks|thank you|gracias|merci|danke|grazie)\b/
const MAX_FAREWELL_WORDS = 6

export function isFarewell(text: string): boolean {
  const plain = normalize(text).replace(/[^\p{L}\p{N}\s]/gu, ' ').replace(/\s+/g, ' ').trim()
  if (!plain || plain.split(' ').length > MAX_FAREWELL_WORDS) return false
  if (FAREWELLS.test(plain)) return true
  return THANKS.test(plain) && plain.split(' ').some((w) => NAMES.test(w))
}
