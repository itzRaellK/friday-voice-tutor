import { useEffect, useRef } from 'react'
import { OrbRenderer, type OrbState } from '../orb/OrbRenderer'

interface Props {
  state: OrbState
  level: () => number
  onClick?: () => void
}

export function Orb({ state, level, onClick }: Props): React.JSX.Element {
  const canvas = useRef<HTMLCanvasElement>(null)
  const renderer = useRef<OrbRenderer | null>(null)

  useEffect(() => {
    const r = new OrbRenderer(canvas.current!)
    renderer.current = r
    return () => r.destroy()
  }, [])

  useEffect(() => renderer.current?.setState(state), [state])
  useEffect(() => renderer.current?.setLevelSource(level), [level])

  return (
    <div className="orb-wrap" onClick={onClick}>
      <canvas ref={canvas} aria-label="Friday" />
    </div>
  )
}
