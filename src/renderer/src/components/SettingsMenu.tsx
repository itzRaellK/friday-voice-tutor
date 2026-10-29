import { useEffect, useRef } from 'react'
import { LANGUAGES, type Language } from '../lib/languages'

interface Props {
  open: boolean
  native: Language
  study: Language
  onNativeChange: (code: string) => void
  onStudyChange: (code: string) => void
  onClose: () => void
}

// Painel discreto aberto pela engrenagem da barra de título. Fecha com Esc ou clique fora.
export function SettingsMenu({ open, native, study, onNativeChange, onStudyChange, onClose }: Props): React.JSX.Element | null {
  const panel = useRef<HTMLDivElement>(null)

  useEffect(() => {
    if (!open) return
    const onDown = (e: PointerEvent): void => {
      const target = e.target as HTMLElement
      if (!panel.current?.contains(target) && !target.closest('[data-settings-toggle]')) onClose()
    }
    const onKey = (e: KeyboardEvent): void => {
      if (e.key === 'Escape') onClose()
    }
    window.addEventListener('pointerdown', onDown)
    window.addEventListener('keydown', onKey)
    return () => {
      window.removeEventListener('pointerdown', onDown)
      window.removeEventListener('keydown', onKey)
    }
  }, [open, onClose])

  if (!open) return null

  const options = LANGUAGES.map((l) => (
    <option key={l.code} value={l.code}>
      {l.name}
    </option>
  ))

  return (
    <div className="settings" ref={panel} role="dialog" aria-label="Idiomas">
      <label className="lang-field" title="A língua das traduções e das explicações das correções">
        <span>Meu idioma</span>
        <select id="native" value={native.code} onChange={(e) => onNativeChange(e.target.value)} autoFocus>
          {options}
        </select>
      </label>
      <label className="lang-field" title="A língua em que a Friday fala com você">
        <span>Estudar</span>
        <select id="lang" value={study.code} onChange={(e) => onStudyChange(e.target.value)}>
          {options}
        </select>
      </label>
    </div>
  )
}
