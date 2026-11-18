'use client'

import { useRef, useState, ReactNode } from 'react'
import { createPortal } from 'react-dom'
import { cn } from '@/lib/utils'

/** shared anchored popover for the context toolbar (canva .cv-pop style) */
export function ToolbarPopover({
  children,
  trigger,
  title,
  width = 232,
}: {
  children: ReactNode
  trigger: (open: boolean) => ReactNode
  title?: string
  width?: number
}) {
  const [open, setOpen] = useState(false)
  const [pos, setPos] = useState<{ x: number; y: number } | null>(null)
  const ref = useRef<HTMLDivElement>(null)

  const toggle = () => {
    if (!open) {
      // [VDS] menus sempre encostados à direita do ecrã, logo abaixo do header
      // do editor (como um painel), em vez de ancorados ao botão
      const header = document.querySelector('header')?.getBoundingClientRect()
      const r = ref.current?.getBoundingClientRect()
      const y = Math.round((header?.bottom ?? r?.bottom ?? 56) + 8)
      setPos({ x: 12, y })
    }
    setOpen(!open)
  }

  return (
    <div ref={ref} className="relative shrink-0">
      <span onClick={toggle}>{trigger(open)}</span>
      {/* [VDS] o menu era absolute dentro da barra (que tem overflow-x:auto) com
          coordenadas do ecrã: ficava fora do sítio e cortado, nunca se via.
          Agora vai para o body (portal) com position fixed. */}
      {open && pos && typeof document !== 'undefined' && createPortal(
        <>
          <div className="fixed inset-0 z-[60]" onClick={() => setOpen(false)} onContextMenu={(e) => { e.preventDefault(); setOpen(false) }} />
          <div
            className="cv-pop"
            style={{ position: 'fixed', zIndex: 61, right: pos.x, top: pos.y, minWidth: width, maxWidth: 'calc(100vw - 24px)', maxHeight: `calc(100vh - ${pos.y + 12}px)`, overflowY: 'auto' }}
          >
            {title && <div className="text-[12px] font-bold text-white/90 mb-2.5">{title}</div>}
            {children}
          </div>
        </>,
        document.body,
      )}
    </div>
  )
}

/** labelled slider row (canva spacing/transparency style) */
export function SliderRow({
  label,
  value,
  min,
  max,
  step,
  defaultValue,
  onChange,
  onCommit,
  format,
}: {
  label: string
  value: number
  min: number
  max: number
  step: number
  defaultValue?: number
  onChange: (v: number) => void
  onCommit?: (v: number) => void
  format?: (v: number) => string
}) {
  return (
    <div className="mb-3.5 last:mb-0">
      <div className="flex items-center justify-between mb-1.5">
        <span className="text-[12px] text-white/80 font-medium">{label}</span>
        <input
          type="number"
          value={Number(value.toFixed(2))}
          min={min}
          max={max}
          step={step}
          onChange={(e) => {
            const v = Number(e.target.value)
            if (!Number.isNaN(v)) onChange(v)
          }}
          onBlur={() => onCommit?.(value)}
          className="h-7 w-16 rounded-lg bg-white/[0.07] border border-white/10 px-2 text-[12px] text-white outline-none focus:border-[#7630D7] [color-scheme:dark]"
          aria-label={label}
        />
      </div>
      <input
        type="range"
        className="cv-slider w-full"
        style={{ background: `linear-gradient(to right, #7630D7 ${((value - min) / (max - min)) * 100}%, rgba(255,255,255,0.14) ${((value - min) / (max - min)) * 100}%)` }}
        min={min}
        max={max}
        step={step}
        value={value}
        onChange={(e) => onChange(Number(e.target.value))}
        onPointerUp={() => onCommit?.(value)}
        aria-label={`${label} slider`}
      />
      {format && <div className="text-[10px] text-white/40 mt-1">{format(value)}</div>}
    </div>
  )
}

/** small square icon tile used in the position popover (canva 2×2 grid) */
export function IconTile({
  icon,
  label,
  onClick,
  disabled,
  active,
}: {
  icon: ReactNode
  label: string
  onClick?: () => void
  disabled?: boolean
  active?: boolean
}) {
  return (
    <button
      onClick={onClick}
      disabled={disabled}
      className={cn(
        'flex flex-col items-center justify-center gap-1 rounded-lg py-2 text-[10px] font-medium text-white/80 transition-colors',
        'hover:bg-white/[0.09] disabled:opacity-35 disabled:pointer-events-none',
        active && 'bg-white/[0.13] text-white'
      )}
      aria-label={label}
    >
      {icon}
      <span>{label}</span>
    </button>
  )
}
