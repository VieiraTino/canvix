// ─────────────────────────────────────────────────────────────
// [VDS] Alteração local da Viagem de Sonho (patches/vds.patch).
// "Recortar à página" no editor: tapa com a cor de fundo do editor
// tudo o que sai fora da página, para se ver o design como fica no
// export. É só visual: não mexe no documento, não entra nos exports
// (esses já recortam à página) e não apanha cliques, por isso uma
// imagem continua a poder ser agarrada pela parte que sai fora.
// Preferência do browser (localStorage), ligada por omissão.
// ─────────────────────────────────────────────────────────────

import { useSyncExternalStore } from 'react'
import { Group, Rect } from 'react-konva'

const STORAGE_KEY = 'vds:clipToPage'
// cor da área à volta da página (bg do editor em Editor.tsx)
const SURROUND = '#0F1015'
// extensão da máscara em unidades da página; chega para qualquer zoom/pan
const FAR = 1_000_000

const listeners = new Set<() => void>()

function read(): boolean {
  try {
    return window.localStorage.getItem(STORAGE_KEY) !== 'off'
  } catch {
    return true
  }
}

function subscribe(cb: () => void) {
  listeners.add(cb)
  return () => {
    listeners.delete(cb)
  }
}

export function setClipToPage(on: boolean) {
  try {
    window.localStorage.setItem(STORAGE_KEY, on ? 'on' : 'off')
  } catch {
    // sem localStorage: fica só nesta sessão
  }
  listeners.forEach((cb) => cb())
}

export function useClipToPage(): boolean {
  return useSyncExternalStore(subscribe, read, () => true)
}

/** Máscara à volta da página, em coordenadas da página (dentro do Group com zoom/pan). */
export function PageOutsideMask({ width, height }: { width: number; height: number }) {
  const common = { fill: SURROUND, listening: false, perfectDrawEnabled: false } as const
  return (
    <Group name="vds-page-mask" listening={false}>
      <Rect x={-FAR} y={-FAR} width={width + 2 * FAR} height={FAR} {...common} />
      <Rect x={-FAR} y={height} width={width + 2 * FAR} height={FAR} {...common} />
      <Rect x={-FAR} y={0} width={FAR} height={height} {...common} />
      <Rect x={width} y={0} width={FAR} height={height} {...common} />
    </Group>
  )
}
