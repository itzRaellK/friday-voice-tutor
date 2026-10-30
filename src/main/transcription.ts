// O Gemma 4 documenta até 30 s por entrada. Mantém cada trecho abaixo disso,
// sem transformar uma divisão técnica de áudio em uma nova mensagem do aluno.
const RATE = 16000
const MAX_SECONDS = 28
const OVERLAP_SECONDS = 0.75
const QUIET_WINDOW_SECONDS = 0.16
const SEARCH_SECONDS = 6

interface AudioChunk {
  wav: Uint8Array
  overlapsPrevious: boolean
}

function pcmData(wav: Uint8Array): Uint8Array {
  const invalid = (): never => { throw new Error('A transcrição espera WAV PCM mono de 16 bits e 16 kHz.') }
  if (wav.length < 44) return invalid()
  const view = new DataView(wav.buffer, wav.byteOffset, wav.byteLength)
  const tag = (offset: number): string => String.fromCharCode(...wav.subarray(offset, offset + 4))
  // Formato canônico produzido por toWav16k/encodeWav no renderer.
  if (tag(0) !== 'RIFF' || tag(8) !== 'WAVE' || tag(12) !== 'fmt ' || tag(36) !== 'data' ||
      view.getUint32(16, true) !== 16 || view.getUint16(20, true) !== 1 ||
      view.getUint16(22, true) !== 1 || view.getUint32(24, true) !== RATE || view.getUint16(34, true) !== 16) return invalid()
  const length = view.getUint32(40, true)
  if (length > wav.length - 44 || length % 2) return invalid()
  return wav.subarray(44, 44 + length)
}

function wrapPcm(header: Uint8Array, pcm: Uint8Array): Uint8Array {
  const wav = new Uint8Array(44 + pcm.length)
  wav.set(header.subarray(0, 44))
  wav.set(pcm, 44)
  const view = new DataView(wav.buffer)
  view.setUint32(4, wav.length - 8, true)
  view.setUint32(40, pcm.length, true)
  return wav
}

/** Prefere uma pequena pausa perto do fim do trecho, sem encerrar a fala do aluno. */
function quietBoundary(pcm: DataView, start: number, end: number): number | undefined {
  const window = Math.round(QUIET_WINDOW_SECONDS * RATE)
  const first = Math.max(start, end - SEARCH_SECONDS * RATE)
  for (let at = end - window; at >= first; at -= Math.round(0.04 * RATE)) {
    let energy = 0
    for (let i = at; i < at + window; i++) {
      const sample = pcm.getInt16(i * 2, true) / 32768
      energy += sample * sample
    }
    if (energy / window < 0.008 ** 2) return at + Math.floor(window / 2)
  }
  return undefined
}

export function* splitTranscriptionAudio(wav: Uint8Array): Generator<AudioChunk> {
  const pcm = pcmData(wav)
  const samples = pcm.length / 2
  const view = new DataView(pcm.buffer, pcm.byteOffset, pcm.byteLength)
  const max = MAX_SECONDS * RATE
  let start = 0
  let overlapsPrevious = false
  while (start < samples) {
    let end = Math.min(start + max, samples)
    let next = end
    let overlapNext = false
    if (end < samples) {
      const quiet = quietBoundary(view, start, end)
      if (quiet !== undefined) end = next = quiet
      else {
        // Sem pausa, repete uma borda curta para reduzir palavras cortadas na divisão.
        next = end - Math.round(OVERLAP_SECONDS * RATE)
        overlapNext = true
      }
    }
    yield { wav: wrapPcm(wav, pcm.subarray(start * 2, end * 2)), overlapsPrevious }
    start = next
    overlapsPrevious = overlapNext
  }
}

/** Remove apenas correspondências na borda de trechos que repetiram áudio. */
export function appendTranscript(previous: string, next: string, overlap: boolean): string {
  const before = previous.trim()
  let after = next.trim()
  if (!before) return after
  if (!after) return before
  if (overlap) {
    const words = (text: string): { word: string; end: number }[] => [...text.matchAll(/\S+/gu)].map((m) => ({
      word: m[0].normalize('NFKC').toLowerCase().replace(/^[^\p{L}\p{N}]+|[^\p{L}\p{N}]+$/gu, ''),
      end: m.index + m[0].length
    }))
    const left = words(before).slice(-30)
    const right = words(after).slice(0, 30)
    for (let count = Math.min(left.length, right.length); count >= 2; count--) {
      if (right.slice(0, count).every((word, i) => word.word && word.word === left[left.length - count + i].word)) {
        after = after.slice(right[count - 1].end).trimStart()
        break
      }
    }
    // Idiomas que não separam palavras por espaços, como chinês e japonês.
    if (left.length === 1 && right.length === 1 && /[\p{Script=Han}\p{Script=Hiragana}\p{Script=Katakana}]/u.test(after)) {
      const a = Array.from(before)
      const b = Array.from(after)
      for (let count = Math.min(a.length, b.length, 40); count >= 4; count--) {
        if (a.slice(-count).join('') === b.slice(0, count).join('')) {
          after = b.slice(count).join('')
          break
        }
      }
    }
  }
  if (!after) return before
  const separator = /[\p{Script=Han}\p{Script=Hiragana}\p{Script=Katakana}]$/u.test(before) &&
    /^[\p{Script=Han}\p{Script=Hiragana}\p{Script=Katakana}]/u.test(after) ? '' : ' '
  return before + separator + after
}

/** Só entrega uma transcrição final depois de todos os trechos terem sucesso. */
export async function transcribeAudio(
  wav: Uint8Array, transcribeChunk: (wav: Uint8Array) => Promise<string>
): Promise<string> {
  let full = ''
  for (const chunk of splitTranscriptionAudio(wav)) {
    const text = await transcribeChunk(chunk.wav)
    full = appendTranscript(full, text, chunk.overlapsPrevious)
  }
  return full
}
