export interface Message {
  id: string
  kind: 'user' | 'assistant'
  raw: string // conteúdo trocado com o modelo
  text: string // texto exibido
  time: number
  lang?: string // língua da mensagem (nas da Friday, a de estudo: é a voz usada para ouvir de novo)
  translation?: string // só nas da Friday: a fala traduzida para a língua do aluno
  hidden?: boolean // instruções internas (ex.: saudação), não aparecem na tela
  viaVoice?: boolean
  pending?: boolean
  error?: boolean
  correction?: string // só em mensagens do aluno
}
