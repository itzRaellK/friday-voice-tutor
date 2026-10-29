// Casos de teste dos prompts. Cada par é "língua do aluno → língua de estudo".
// Servem para medir mudanças de prompt ou de modelo, não para criar regras por idioma.

export interface DetectCase {
  usage: string
  study: string
  text: string
  expect: 'usage' | 'study'
}

export interface CorrectionCase {
  usage: string
  study: string
  text: string
  hasError: boolean
}

/** Uma mensagem do aluno, em qualquer das duas línguas: a Friday deve responder na de estudo. */
export interface ReplyCase {
  usage: string
  study: string
  text: string
}

export const DETECT: DetectCase[] = [
  { usage: 'pt', study: 'fr', text: 'Como se diz bom dia em francês?', expect: 'usage' },
  { usage: 'pt', study: 'fr', text: 'Je voudrais un café, s’il vous plaît.', expect: 'study' },
  { usage: 'pt', study: 'fr', text: 'Oui, merci.', expect: 'study' },
  { usage: 'pt', study: 'fr', text: 'Não entendi, pode repetir?', expect: 'usage' },
  { usage: 'pt', study: 'es', text: 'Ayer fui al cine con mis amigos.', expect: 'study' },
  { usage: 'pt', study: 'es', text: 'Qual a diferença entre ser e estar?', expect: 'usage' },
  { usage: 'pt', study: 'en', text: 'I would like to talk about my job.', expect: 'study' },
  { usage: 'pt', study: 'en', text: 'Me explica quando usar o present perfect.', expect: 'usage' },
  { usage: 'en', study: 'de', text: 'How do I say thank you in German?', expect: 'usage' },
  { usage: 'en', study: 'de', text: 'Ich habe Hunger.', expect: 'study' },
  { usage: 'es', study: 'en', text: '¿Cómo se pronuncia "through"?', expect: 'usage' },
  { usage: 'es', study: 'en', text: 'Yesterday I went to the beach.', expect: 'study' },
  { usage: 'en', study: 'ja', text: 'わたしはがくせいです。', expect: 'study' },
  { usage: 'en', study: 'ja', text: 'What does sumimasen mean?', expect: 'usage' }
]

export const CORRECTION: CorrectionCase[] = [
  { usage: 'pt', study: 'fr', text: 'Je suis allé au plage hier avec mon amis.', hasError: true },
  { usage: 'pt', study: 'fr', text: 'Hier, je mangé une pizza.', hasError: true },
  { usage: 'pt', study: 'fr', text: 'Je voudrais réserver une table pour deux.', hasError: false },
  { usage: 'pt', study: 'es', text: 'Ayer yo voy a la playa con mis amigos.', hasError: true },
  { usage: 'pt', study: 'es', text: 'Yo soy cansado hoy.', hasError: true },
  { usage: 'pt', study: 'es', text: 'Me gusta mucho viajar en verano.', hasError: false },
  { usage: 'pt', study: 'en', text: 'Yesterday I go to the cinema.', hasError: true },
  { usage: 'pt', study: 'en', text: 'She don’t like coffee.', hasError: true },
  { usage: 'pt', study: 'en', text: 'I love cooking pasta on weekends.', hasError: false },
  { usage: 'pt', study: 'de', text: 'Ich habe gestern ins Kino gegangen.', hasError: true },
  { usage: 'pt', study: 'de', text: 'Ich wohne seit drei Jahren in Berlin.', hasError: false },
  { usage: 'pt', study: 'it', text: 'Io sono andato al mare con i miei amici.', hasError: false },
  { usage: 'pt', study: 'it', text: 'Io ho andato al mare ieri.', hasError: true },
  { usage: 'en', study: 'de', text: 'Ich habe gestern ins Kino gegangen.', hasError: true },
  { usage: 'en', study: 'fr', text: 'Je suis très faim.', hasError: true },
  { usage: 'en', study: 'es', text: 'Tengo veinte años y vivo en Madrid.', hasError: false },
  { usage: 'es', study: 'en', text: 'Yesterday I go to the cinema with my friends.', hasError: true },
  { usage: 'es', study: 'en', text: 'He have two brothers.', hasError: true },
  { usage: 'es', study: 'fr', text: 'Nous sommes allés au cinéma hier soir.', hasError: false },
  { usage: 'fr', study: 'en', text: 'I am agree with you.', hasError: true }
]

export const REPLY: ReplyCase[] = [
  { usage: 'pt', study: 'fr', text: 'Como se diz bom dia em francês?' },
  { usage: 'pt', study: 'fr', text: 'Je suis allé au plage hier avec mon amis.' },
  { usage: 'pt', study: 'es', text: 'Qual a diferença entre ser e estar?' },
  { usage: 'pt', study: 'es', text: 'Me gusta mucho el fútbol.' },
  { usage: 'pt', study: 'en', text: 'Me ensina a pedir um café em inglês.' },
  { usage: 'pt', study: 'en', text: 'I would like to talk about my job.' },
  { usage: 'en', study: 'de', text: 'How do I say thank you in German?' },
  { usage: 'es', study: 'en', text: '¿Cómo pido la cuenta en un restaurante?' }
]
