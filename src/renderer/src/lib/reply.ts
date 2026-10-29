// Interpreta a resposta do modelo enquanto chega em stream e separa frases prontas para a voz.
// Tudo o que a Friday diz é na língua de estudo, então uma voz só lê a resposta inteira.

const SENTENCE_END = /[.!?。！？…]+["'»”)]*(?=\s)|\n+/g

export function cleanForSpeech(s: string): string {
  return s
    .replace(/[*_`#>~]/g, '')
    .replace(/\p{Extended_Pictographic}/gu, '')
    .replace(/\s+/g, ' ')
    .trim()
}

export class ReplyStream {
  raw = ''
  private spokenUpTo = 0

  push(token: string): void {
    this.raw += token
  }

  get visible(): string {
    return this.raw.trimStart()
  }

  /** Frases completas ainda não faladas. Com `final`, devolve também o resto. */
  takeSentences(final = false): string[] {
    const text = this.visible
    const out: string[] = []
    SENTENCE_END.lastIndex = this.spokenUpTo
    let m: RegExpExecArray | null
    while ((m = SENTENCE_END.exec(text))) {
      const end = m.index + m[0].length
      out.push(text.slice(this.spokenUpTo, end))
      this.spokenUpTo = end
    }
    if (final && this.spokenUpTo < text.length) {
      out.push(text.slice(this.spokenUpTo))
      this.spokenUpTo = text.length
    }
    return out.map(cleanForSpeech).filter((s) => /[\p{L}\p{N}]/u.test(s))
  }
}
