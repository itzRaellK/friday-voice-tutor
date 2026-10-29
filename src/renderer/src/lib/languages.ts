export interface Language {
  code: string
  name: string // nome em português, para a UI
  english: string // nome em inglês, para o prompt
  voice: string // sufixo da voz no lfm3-omni
  aliases: string // nomes que o aluno pode usar para pedir o idioma
}

export const LANGUAGES: Language[] = [
  { code: 'en', name: 'Inglês (EUA)', english: 'English', voice: 'american-english', aliases: 'inglês|ingles|english|inglés|anglais|englisch|inglese' },
  { code: 'en-gb', name: 'Inglês (Reino Unido)', english: 'British English', voice: 'british-english', aliases: 'inglês britânico|ingles britanico|british english|british' },
  { code: 'es', name: 'Espanhol', english: 'Spanish', voice: 'spanish', aliases: 'espanhol|spanish|español|espagnol|spanisch|castellano' },
  { code: 'fr', name: 'Francês', english: 'French', voice: 'french', aliases: 'francês|frances|french|français|francés|französisch|francese' },
  { code: 'de', name: 'Alemão', english: 'German', voice: 'german', aliases: 'alemão|alemao|german|deutsch|alemán|allemand|tedesco' },
  { code: 'it', name: 'Italiano', english: 'Italian', voice: 'italian', aliases: 'italiano|italian|italien|italienisch' },
  { code: 'pt', name: 'Português (Brasil)', english: 'Brazilian Portuguese', voice: 'portuguese', aliases: 'português|portugues|portuguese|portugués|portugais' },
  { code: 'ja', name: 'Japonês', english: 'Japanese', voice: 'japanese', aliases: 'japonês|japones|japanese|japonés|japonais|日本語' },
  { code: 'ko', name: 'Coreano', english: 'Korean', voice: 'korean', aliases: 'coreano|korean|coréen|한국어' },
  { code: 'zh', name: 'Chinês', english: 'Chinese (Mandarin)', voice: 'chinese', aliases: 'chinês|chines|chinese|mandarim|mandarin|chino|中文' },
  { code: 'nl', name: 'Holandês', english: 'Dutch', voice: 'dutch', aliases: 'holandês|holandes|dutch|neerlandês|nederlands' },
  { code: 'sv', name: 'Sueco', english: 'Swedish', voice: 'swedish', aliases: 'sueco|swedish|svenska' },
  { code: 'da', name: 'Dinamarquês', english: 'Danish', voice: 'danish', aliases: 'dinamarquês|dinamarques|danish|dansk' },
  { code: 'fi', name: 'Finlandês', english: 'Finnish', voice: 'finnish', aliases: 'finlandês|finlandes|finnish|suomi' },
  { code: 'pl', name: 'Polonês', english: 'Polish', voice: 'polish', aliases: 'polonês|polones|polish|polski' },
  { code: 'tr', name: 'Turco', english: 'Turkish', voice: 'turkish', aliases: 'turco|turkish|türkçe' },
  { code: 'el', name: 'Grego', english: 'Greek', voice: 'greek', aliases: 'grego|greek|ελληνικά' },
  { code: 'ar', name: 'Árabe', english: 'Arabic', voice: 'arabic', aliases: 'árabe|arabe|arabic|العربية' },
  { code: 'he', name: 'Hebraico', english: 'Hebrew', voice: 'hebrew', aliases: 'hebraico|hebrew|עברית' }
]

export type VoiceGender = 'female' | 'male'

export function findLanguage(code: string | undefined): Language | undefined {
  if (!code) return undefined
  const c = code.toLowerCase()
  return LANGUAGES.find((l) => l.code === c) ?? LANGUAGES.find((l) => l.code === c.split('-')[0])
}

// O modelo pequeno nem sempre troca de idioma quando o aluno pede; o app detecta o pedido antes.
const SWITCH_VERBS =
  /\b(pratic\w*|practi[cs]\w*|falar|fala|speak\w*|talk\w*|hablar|parler|sprechen|parlare|aprender|learn\w*|estudar|study|mudar|trocar|switch\w*|change|em)\b/i

export function detectLanguageSwitch(text: string): Language | undefined {
  const lower = text.toLowerCase()
  if (!SWITCH_VERBS.test(lower)) return undefined
  let best: { lang: Language; len: number } | undefined
  for (const lang of LANGUAGES) {
    for (const alias of lang.aliases.split('|')) {
      const re = new RegExp(`(^|[^\\p{L}])${alias}($|[^\\p{L}])`, 'u')
      if (re.test(lower) && (!best || alias.length > best.len)) best = { lang, len: alias.length }
    }
  }
  return best?.lang
}

export function voiceFor(lang: Language, gender: VoiceGender): string {
  return `${gender}-${lang.voice}`
}
