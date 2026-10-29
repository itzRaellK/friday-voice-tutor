// Sinais curtos e sintetizados: um sobe quando a conversa abre, o outro desce quando ela fecha.
let ctx: AudioContext | null = null

function chime(notes: [number, number][]): void {
  ctx ??= new AudioContext()
  void ctx.resume()
  const t = ctx.currentTime
  for (const [freq, start] of notes) {
    const osc = ctx.createOscillator()
    const gain = ctx.createGain()
    osc.type = 'sine'
    osc.frequency.value = freq
    gain.gain.setValueAtTime(0, t + start)
    gain.gain.linearRampToValueAtTime(0.08, t + start + 0.015)
    gain.gain.exponentialRampToValueAtTime(0.001, t + start + 0.35)
    osc.connect(gain).connect(ctx.destination)
    osc.start(t + start)
    osc.stop(t + start + 0.4)
  }
}

export const playOpenChime = (): void => chime([[660, 0], [990, 0.09]])
export const playCloseChime = (): void => chime([[880, 0], [587, 0.1]])
