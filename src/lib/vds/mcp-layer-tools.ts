// ─────────────────────────────────────────────────────────────
// [VDS] Alteração local da Viagem de Sonho.
// Ferramenta MCP arrange_element: muda a ordem das camadas de uma
// página, como o painel Layers / o menu do botão direito do editor.
//
// A ordem é a do array page.elements: índice 0 é a camada de trás, o
// último é a da frente (igual ao moveLayer do editor-store). Grava pelo
// mutateDesign, que avisa os editores abertos (pages:replace).
// ─────────────────────────────────────────────────────────────

import type { ToolDef, ToolResult } from '@/lib/mcp/tools'
import type { AnyElement, PageData } from '@/lib/types'

type MutateDesign = (
  designId: string,
  fn: (pages: PageData[], width: number, height: number) => { pages: PageData[]; summary: Record<string, unknown> } | null
) => Promise<ToolResult>

const ACTIONS = ['front', 'forward', 'backward', 'back', 'above', 'below', 'index'] as const
type Action = (typeof ACTIONS)[number]

function str(v: unknown): string {
  return typeof v === 'string' ? v.trim() : ''
}

function layerLabel(el: AnyElement): string {
  const named = (el as { name?: string }).name
  if (named) return named.slice(0, 40)
  if (el.type === 'text') return `"${String((el as { text?: string }).text ?? '').slice(0, 30)}"`
  return el.type
}

export function buildVdsLayerTools(mutateDesign: MutateDesign): ToolDef[] {
  const arrangeElement: ToolDef = {
    name: 'arrange_element',
    description:
      'Change the layer order (z-order) of an element on its page, like the editor Layers panel. Layer 0 is the back, the last layer is the front; elements added later start on top. action: "front" | "forward" (one up) | "backward" (one down) | "back" | "above" / "below" (right above/below relative_to element_id, e.g. text above a photo) | "index" (exact layer index). Returns the new order of the page, back to front.',
    inputSchema: {
      type: 'object',
      properties: {
        design_id: { type: 'string' },
        element_id: { type: 'string', description: 'Element to move (ids from get_design)' },
        action: { type: 'string', enum: [...ACTIONS] },
        relative_to: { type: 'string', description: 'For "above" / "below": the element id to place it next to (same page)' },
        index: { type: 'number', minimum: 0, description: 'For "index": target layer index (0 = back)' },
        page: { type: 'number', minimum: 0, description: 'Page index; default: the page that holds element_id' },
      },
      required: ['design_id', 'element_id', 'action'],
    },
    handler: async (args) => {
      const designId = str(args.design_id)
      const elementId = str(args.element_id)
      const action = (ACTIONS as readonly string[]).includes(str(args.action)) ? (str(args.action) as Action) : null
      const relativeTo = str(args.relative_to)

      let problem = ''
      const result = await mutateDesign(designId, (pages) => {
        const explicitPage = typeof args.page === 'number' && Number.isFinite(args.page) ? Math.round(args.page) : null
        const pageIndex = explicitPage ?? pages.findIndex((p) => p.elements.some((e) => e.id === elementId))
        const page = pages[pageIndex]
        if (!action) { problem = `action must be one of: ${ACTIONS.join(', ')}.`; return null }
        if (!page) { problem = `Element "${elementId}" was not found in this design.`; return null }
        const els = [...page.elements]
        const from = els.findIndex((e) => e.id === elementId)
        if (from === -1) { problem = `Element "${elementId}" is not on page ${pageIndex}.`; return null }

        const [moving] = els.splice(from, 1)
        let to: number
        switch (action) {
          case 'front': to = els.length; break
          case 'back': to = 0; break
          case 'forward': to = Math.min(els.length, from + 1); break
          case 'backward': to = Math.max(0, from - 1); break
          case 'index': {
            const n = typeof args.index === 'number' && Number.isFinite(args.index) ? Math.round(args.index) : NaN
            if (Number.isNaN(n)) { problem = 'action "index" needs a numeric index.'; return null }
            to = Math.min(Math.max(0, n), els.length)
            break
          }
          case 'above':
          case 'below': {
            if (!relativeTo || relativeTo === elementId) { problem = `action "${action}" needs relative_to (another element id).`; return null }
            const ref = els.findIndex((e) => e.id === relativeTo)
            if (ref === -1) { problem = `relative_to "${relativeTo}" is not on page ${pageIndex}.`; return null }
            to = action === 'above' ? ref + 1 : ref
            break
          }
        }
        els.splice(to, 0, moving)
        const nextPages = pages.map((p, i) => (i === pageIndex ? { ...p, elements: els } : p))
        return {
          pages: nextPages,
          summary: {
            element_id: elementId,
            page: pageIndex,
            from_index: from,
            to_index: to,
            layers_back_to_front: els.map((e, i) => ({ index: i, element_id: e.id, type: e.type, label: layerLabel(e) })),
          },
        }
      })
      // o mutateDesign dá uma mensagem genérica quando a função devolve null; aqui damos a razão
      if (problem && result.isError) return { content: [{ type: 'text', text: problem }], isError: true }
      return result
    },
  }

  return [arrangeElement]
}
