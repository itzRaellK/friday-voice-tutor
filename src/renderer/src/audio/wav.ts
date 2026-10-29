// O /v1/audio/speech do Ollama devolve WAV em stream, com tamanhos 0xFFFFFFFF no cabeçalho.
// O decodificador lê o cabeçalho e depois converte o PCM 16-bit conforme os bytes chegam.

export class WavStreamDecoder {
  sampleRate = 0
  private channels = 1
  private header: Uint8Array | null = new Uint8Array(0)
  private carry: Uint8Array = new Uint8Array(0) // byte ímpar que sobrou entre pedaços

  /** Devolve as amostras (mono, -1..1) que este pedaço completou. */
  push(chunk: Uint8Array): Float32Array {
    let data = chunk
    if (this.header) {
      const joined = concat(this.header, chunk)
      const start = this.findData(joined)
      if (start < 0) {
        this.header = joined
        return new Float32Array(0)
      }
      this.header = null
      data = joined.subarray(start)
    }
    const bytes = this.carry.length ? concat(this.carry, data) : data
    const frameBytes = 2 * this.channels
    const usable = bytes.length - (bytes.length % frameBytes)
    this.carry = bytes.slice(usable)
    const view = new DataView(bytes.buffer, bytes.byteOffset, usable)
    const out = new Float32Array(usable / frameBytes)
    for (let i = 0; i < out.length; i++) out[i] = view.getInt16(i * frameBytes, true) / 32768 // canal 0
    return out
  }

  /** Posição do início do PCM, ou -1 se o cabeçalho ainda não chegou inteiro. */
  private findData(bytes: Uint8Array): number {
    if (bytes.length < 12) return -1
    const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength)
    const tag = (o: number): string => String.fromCharCode(...bytes.subarray(o, o + 4))
    if (tag(0) !== 'RIFF' || tag(8) !== 'WAVE') throw new Error('Áudio não é WAV')
    let offset = 12
    while (offset + 8 <= bytes.length) {
      const id = tag(offset)
      const size = view.getUint32(offset + 4, true)
      if (id === 'data') return offset + 8
      if (id === 'fmt ') {
        if (offset + 24 > bytes.length) return -1
        this.channels = view.getUint16(offset + 10, true)
        this.sampleRate = view.getUint32(offset + 12, true)
        const bits = view.getUint16(offset + 22, true)
        if (bits !== 16) throw new Error(`WAV de ${bits} bits não suportado`)
      }
      offset += 8 + size + (size % 2)
    }
    return -1
  }
}

function concat(a: Uint8Array, b: Uint8Array): Uint8Array {
  const out = new Uint8Array(a.length + b.length)
  out.set(a)
  out.set(b, a.length)
  return out
}

export function encodeWav(samples: Float32Array, sampleRate: number): Uint8Array {
  const out = new DataView(new ArrayBuffer(44 + samples.length * 2))
  const write = (o: number, s: string): void => [...s].forEach((c, i) => out.setUint8(o + i, c.charCodeAt(0)))
  write(0, 'RIFF')
  out.setUint32(4, 36 + samples.length * 2, true)
  write(8, 'WAVE')
  write(12, 'fmt ')
  out.setUint32(16, 16, true)
  out.setUint16(20, 1, true) // PCM
  out.setUint16(22, 1, true) // mono
  out.setUint32(24, sampleRate, true)
  out.setUint32(28, sampleRate * 2, true)
  out.setUint16(32, 2, true)
  out.setUint16(34, 16, true)
  write(36, 'data')
  out.setUint32(40, samples.length * 2, true)
  samples.forEach((s, i) => out.setInt16(44 + i * 2, Math.max(-1, Math.min(1, s)) * 0x7fff, true))
  return new Uint8Array(out.buffer)
}

const STT_RATE = 16000

/** Reamostra para WAV mono 16 kHz, o formato que a transcrição aceita. */
export async function toWav16k(samples: Float32Array<ArrayBuffer>, sampleRate: number): Promise<Uint8Array> {
  const frames = Math.max(1, Math.ceil((samples.length / sampleRate) * STT_RATE))
  const offline = new OfflineAudioContext(1, frames, STT_RATE)
  const buffer = offline.createBuffer(1, samples.length, sampleRate)
  buffer.copyToChannel(samples, 0)
  const src = offline.createBufferSource()
  src.buffer = buffer
  src.connect(offline.destination)
  src.start()
  const rendered = await offline.startRendering()
  return encodeWav(rendered.getChannelData(0), STT_RATE)
}
