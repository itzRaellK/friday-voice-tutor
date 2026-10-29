// Esfera de ~1.400 nós ligados por fios elásticos, desenhada em canvas 2D.
// O estado muda o comportamento (respirar, tremer, girar, pulsar) e o volume real da voz modula a intensidade.

export type OrbState = 'idle' | 'listening' | 'thinking' | 'speaking'

type RGB = [number, number, number]

const N = 1400
const NEIGHBORS = 3
const STATES: OrbState[] = ['idle', 'listening', 'thinking', 'speaking']

const mix = (a: RGB, b: RGB, t: number): RGB => [a[0] + (b[0] - a[0]) * t, a[1] + (b[1] - a[1]) * t, a[2] + (b[2] - a[2]) * t]
const rgba = (c: RGB, a: number): string => `rgba(${c[0] | 0},${c[1] | 0},${c[2] | 0},${a})`
const layer = (z: number): number => (z < -0.35 ? 0 : z < 0.35 ? 1 : 2)

function parseColor(value: string): RGB {
  const h = value.trim().replace('#', '')
  return [0, 2, 4].map((i) => parseInt(h.slice(i, i + 2), 16)) as RGB
}

// Geometria fixa, compartilhada entre instâncias.
const geometry = (() => {
  const bx = new Float32Array(N), by = new Float32Array(N), bz = new Float32Array(N), ph = new Float32Array(N)
  const golden = Math.PI * (3 - Math.sqrt(5))
  for (let i = 0; i < N; i++) {
    const y = 1 - (i / (N - 1)) * 2, r = Math.sqrt(1 - y * y), a = i * golden
    bx[i] = Math.cos(a) * r
    by[i] = y
    bz[i] = Math.sin(a) * r
    ph[i] = Math.random() * Math.PI * 2
  }
  const seen = new Set<number>()
  const edges: number[] = []
  for (let i = 0; i < N; i++) {
    const best: [number, number][] = []
    for (let j = 0; j < N; j++) {
      if (j === i) continue
      const d = (bx[i] - bx[j]) ** 2 + (by[i] - by[j]) ** 2 + (bz[i] - bz[j]) ** 2
      if (best.length < NEIGHBORS || d < best[NEIGHBORS - 1][0]) {
        best.push([d, j])
        best.sort((p, q) => p[0] - q[0])
        if (best.length > NEIGHBORS) best.pop()
      }
    }
    for (const [, j] of best) {
      const key = i < j ? i * N + j : j * N + i
      if (!seen.has(key)) {
        seen.add(key)
        edges.push(i, j)
      }
    }
  }
  return { bx, by, bz, ph, edges: Int32Array.from(edges) }
})()

export class OrbRenderer {
  private ctx: CanvasRenderingContext2D
  private w: Record<OrbState, number> = { idle: 1, listening: 0, thinking: 0, speaking: 0 }
  private target: OrbState = 'idle'
  private level = 0
  private levelSource: () => number = () => 0
  private colors = { orb: [255, 179, 71] as RGB, cool: [143, 216, 255] as RGB, hot: [255, 107, 61] as RGB, spark: [255, 244, 228] as RGB, dark: true }
  private sx = new Float32Array(N)
  private sy = new Float32Array(N)
  private sz = new Float32Array(N)
  private sparks: { e: number; p: number; v: number }[] = []
  private rot = 0
  private last = performance.now()
  private width = 0
  private height = 0
  private raf = 0
  private stopped = false
  private observer: ResizeObserver
  private schemeQuery = matchMedia('(prefers-color-scheme: dark)')
  private reduced = matchMedia('(prefers-reduced-motion: reduce)').matches

  constructor(private canvas: HTMLCanvasElement) {
    this.ctx = canvas.getContext('2d')!
    this.observer = new ResizeObserver(() => this.resize())
    this.observer.observe(canvas)
    this.resize()
    this.readColors()
    this.schemeQuery.addEventListener('change', this.readColors)
    this.raf = requestAnimationFrame(this.frame)
  }

  setState(state: OrbState): void {
    this.target = state
  }

  setLevelSource(source: () => number): void {
    this.levelSource = source
  }

  destroy(): void {
    this.stopped = true
    cancelAnimationFrame(this.raf)
    this.observer.disconnect()
    this.schemeQuery.removeEventListener('change', this.readColors)
  }

  private readColors = (): void => {
    const css = getComputedStyle(this.canvas)
    this.colors = {
      orb: parseColor(css.getPropertyValue('--orb')),
      cool: parseColor(css.getPropertyValue('--orb-cool')),
      hot: parseColor(css.getPropertyValue('--orb-hot')),
      spark: parseColor(css.getPropertyValue('--spark')),
      dark: this.schemeQuery.matches
    }
  }

  private resize(): void {
    const dpr = Math.min(devicePixelRatio || 1, 2)
    const r = this.canvas.getBoundingClientRect()
    this.width = r.width
    this.height = r.height
    this.canvas.width = Math.round(r.width * dpr)
    this.canvas.height = Math.round(r.height * dpr)
    this.ctx.setTransform(dpr, 0, 0, dpr, 0, 0)
  }

  private frame = (now: number): void => {
    if (this.stopped) return
    // Com movimento reduzido, desenha ~8 quadros por segundo.
    this.raf = this.reduced ? window.setTimeout(() => requestAnimationFrame(this.frame), 120) : requestAnimationFrame(this.frame)
    const dt = Math.min((now - this.last) / 1000, 0.05)
    this.last = now
    const t = now / 1000
    const { w, ctx, sx, sy, sz, colors } = this
    const { bx, by, bz, ph, edges } = geometry
    const E = edges.length / 2

    for (const s of STATES) w[s] += ((s === this.target ? 1 : 0) - w[s]) * Math.min(1, dt * 3)
    const want = (w.speaking + w.listening) * this.levelSource()
    this.level += (want - this.level) * Math.min(1, dt * 12)
    const level = this.level

    this.rot += dt * (0.12 + w.thinking * 0.5 + w.speaking * 0.08)
    const cr = Math.cos(this.rot), sr = Math.sin(this.rot)
    const tilt = 0.32 + Math.sin(t * 0.21) * 0.08, ct = Math.cos(tilt), st = Math.sin(tilt)
    const W = this.width, H = this.height
    const R = Math.min(W, H) * 0.38, cx = W / 2, cy = H / 2

    for (let i = 0; i < N; i++) {
      let x = bx[i], y = by[i], z = bz[i]
      if (w.thinking > 0.001) {
        const a = w.thinking * 0.55 * Math.sin(t * 2.2 + y * 5), c = Math.cos(a), s = Math.sin(a), nx = x * c - z * s
        z = x * s + z * c
        x = nx
      }
      let r = 1 + 0.025 * Math.sin(t * 0.9 + ph[i]) * (w.idle + 0.4)
      r += w.listening * (0.02 + level * 0.18) * Math.sin(x * 6 + t * 5) * Math.sin(y * 7 - t * 4)
      r += w.thinking * 0.05 * Math.sin(ph[i] + t * 6)
      r += w.speaking * (0.01 + level * 0.16) * Math.sin(Math.acos(Math.max(-1, Math.min(1, z))) * 7 - t * 9)
      x *= r
      y *= r
      z *= r
      const x1 = x * cr + z * sr, z1 = -x * sr + z * cr
      const y2 = y * ct - z1 * st, z2 = y * st + z1 * ct
      const p = 3.2 / (3.2 - z2)
      sx[i] = cx + x1 * R * p
      sy[i] = cy + y2 * R * p
      sz[i] = z2
    }

    const base = mix(mix(colors.orb, colors.cool, w.listening), colors.hot, w.thinking * 0.8)
    ctx.clearRect(0, 0, W, H)
    const glow = ctx.createRadialGradient(cx, cy, 0, cx, cy, R * 1.5)
    glow.addColorStop(0, rgba(base, (colors.dark ? 0.16 : 0.1) + level * 0.1 + w.thinking * 0.06))
    glow.addColorStop(0.5, rgba(base, 0.03))
    glow.addColorStop(1, rgba(base, 0))
    ctx.fillStyle = glow
    ctx.fillRect(0, 0, W, H)

    // No escuro as luzes somam; no claro, tinta normal.
    ctx.globalCompositeOperation = colors.dark ? 'lighter' : 'source-over'
    const lineAlpha = colors.dark ? [0.05, 0.12, 0.26] : [0.06, 0.13, 0.3]
    const dotAlpha = colors.dark ? [0.25, 0.55, 0.95] : [0.2, 0.45, 0.85]
    const dotColor = colors.dark ? mix(base, [255, 244, 228], 0.35) : base
    const wobble = 0.18 + w.thinking * 0.35 + level * 0.25

    for (let k = 0; k < 3; k++) {
      ctx.beginPath()
      for (let e = 0; e < E; e++) {
        const a = edges[e * 2], b = edges[e * 2 + 1]
        if (layer((sz[a] + sz[b]) / 2) !== k) continue
        const ax = sx[a], ay = sy[a], bx2 = sx[b], by2 = sy[b], o = Math.sin(t * 1.7 + e * 0.37) * wobble
        ctx.moveTo(ax, ay)
        ctx.quadraticCurveTo((ax + bx2) / 2 - (by2 - ay) * o, (ay + by2) / 2 + (bx2 - ax) * o, bx2, by2)
      }
      ctx.strokeStyle = rgba(base, lineAlpha[k] * (1 + level * 0.6))
      ctx.lineWidth = k === 2 ? 0.8 : 0.6
      ctx.stroke()
    }
    for (let k = 0; k < 3; k++) {
      ctx.beginPath()
      for (let i = 0; i < N; i++) {
        if (layer(sz[i]) !== k) continue
        const s = 0.6 + (sz[i] + 1) * 0.7 + level * 0.5
        ctx.rect(sx[i] - s / 2, sy[i] - s / 2, s, s)
      }
      ctx.fillStyle = rgba(dotColor, dotAlpha[k])
      ctx.fill()
    }

    // Faíscas correndo pelos fios enquanto pensa (e algumas enquanto fala).
    const spawn = (w.thinking * 90 + w.speaking * 12) * dt
    for (let s = 0; s < spawn; s++) {
      if (Math.random() < spawn - s) this.sparks.push({ e: (Math.random() * E) | 0, p: 0, v: 1.5 + Math.random() * 2 })
    }
    ctx.beginPath()
    for (let s = this.sparks.length - 1; s >= 0; s--) {
      const sp = this.sparks[s]
      sp.p += sp.v * dt
      if (sp.p >= 1) {
        this.sparks.splice(s, 1)
        continue
      }
      const a = edges[sp.e * 2], b = edges[sp.e * 2 + 1]
      if (sz[a] < -0.2) continue
      const x = sx[a] + (sx[b] - sx[a]) * sp.p, y = sy[a] + (sy[b] - sy[a]) * sp.p
      ctx.moveTo(x + 2, y)
      ctx.arc(x, y, 2, 0, Math.PI * 2)
    }
    ctx.fillStyle = rgba(colors.spark, 0.9)
    ctx.fill()
    ctx.globalCompositeOperation = 'source-over'
  }
}
