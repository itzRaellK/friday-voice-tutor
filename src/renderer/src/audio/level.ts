// Volume instantâneo (0..1) de um AnalyserNode, usado para a esfera reagir à voz.
export function analyserLevel(analyser: AnalyserNode, buffer: Float32Array<ArrayBuffer>): number {
  analyser.getFloatTimeDomainData(buffer)
  let sum = 0
  for (let i = 0; i < buffer.length; i++) sum += buffer[i] * buffer[i]
  return Math.min(1, Math.sqrt(sum / buffer.length) * 5)
}

export function createAnalyser(ctx: BaseAudioContext): { analyser: AnalyserNode; level: () => number } {
  const analyser = ctx.createAnalyser()
  analyser.fftSize = 1024
  const buffer = new Float32Array(analyser.fftSize)
  return { analyser, level: () => analyserLevel(analyser, buffer) }
}
