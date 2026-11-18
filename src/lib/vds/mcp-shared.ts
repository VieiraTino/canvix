// ─────────────────────────────────────────────────────────────
// [VDS] Alteração local da Viagem de Sonho.
// Peças comuns às ferramentas MCP nossas (uploads, páginas, resize,
// grupos/alinhar/distribuir).
// ─────────────────────────────────────────────────────────────

import { textResult, type ToolResult } from '@/lib/mcp/tools'
import { pageSize } from '@/lib/editor-utils'
import type { AnyElement, PageData } from '@/lib/types'

/** o wrapper do tools.ts: carrega o design, aplica fn às páginas, grava e avisa os editores */
export type MutateDesign = (
  designId: string,
  fn: (pages: PageData[], width: number, height: number) => { pages: PageData[]; summary: Record<string, unknown> } | null
) => Promise<ToolResult>

export function ok(data: unknown): ToolResult {
  return textResult(JSON.stringify(data, null, 2))
}

export function fail(message: string): ToolResult {
  return textResult(message, true)
}

export function str(v: unknown): string {
  return typeof v === 'string' ? v.trim() : ''
}

export function num(v: unknown): number | null {
  return typeof v === 'number' && Number.isFinite(v) ? v : null
}

export function intArg(v: unknown): number | null {
  const n = typeof v === 'number' ? v : typeof v === 'string' && v.trim() !== '' ? Number(v) : NaN
  return Number.isFinite(n) ? Math.round(n) : null
}

export function strList(v: unknown): string[] {
  return Array.isArray(v) ? v.map((x) => (typeof x === 'string' ? x.trim() : '')).filter(Boolean) : []
}

export function clamp(n: number, min: number, max: number): number {
  return Math.min(max, Math.max(min, n))
}

/** tamanho real da página (o override por página ganha ao tamanho do design) */
export function sizeOfPage(page: PageData, designW: number, designH: number): { width: number; height: number } {
  return pageSize(page, designW, designH)
}

/** índice da página que tem o elemento (só nível de topo), ou -1 */
export function pageIndexOf(pages: PageData[], elementId: string): number {
  return pages.findIndex((p) => p.elements.some((e) => e.id === elementId))
}

/** página pedida (args.page) ou a que tem o primeiro elemento */
export function resolvePage(pages: PageData[], pageArg: unknown, firstElementId: string): number {
  const explicit = intArg(pageArg)
  if (explicit !== null) return explicit
  return firstElementId ? pageIndexOf(pages, firstElementId) : 0
}

/** resumo curto de uma camada, para as respostas */
export function layerInfo(el: AnyElement, index: number) {
  const named = (el as { name?: string }).name
  const label = named
    ? named.slice(0, 40)
    : el.type === 'text'
      ? `"${String((el as { text?: string }).text ?? '').slice(0, 30)}"`
      : el.type
  return { index, element_id: el.id, type: el.type, label, x: Math.round(el.x), y: Math.round(el.y), width: Math.round(el.width), height: Math.round(el.height) }
}
