// ─────────────────────────────────────────────────────────────
// [VDS] Alteração local da Viagem de Sonho.
// Ferramentas MCP de arrumação: group_elements, ungroup_element,
// align_elements e distribute_elements. Mesma matemática do
// editor-store (groupSelection, ungroupSelection, alignElements,
// distributeElements), com duas diferenças pensadas para o agente:
// - o grupo fica na camada do elemento de cima, não à frente de tudo,
//   e os filhos de um desagrupar voltam para essa mesma camada;
// - align pode ser à página (como o editor) ou ao conjunto (selection).
// ─────────────────────────────────────────────────────────────

import type { ToolDef } from '@/lib/mcp/tools'
import { distributeEvenly } from '@/lib/distribute'
import { createGroupElement, type AnyElement } from '@/lib/types'
import { layerInfo, resolvePage, sizeOfPage, str, strList, type MutateDesign } from './mcp-shared'

const ALIGN = ['left', 'center', 'right', 'top', 'middle', 'bottom'] as const
type AlignMode = (typeof ALIGN)[number]

function errorResult(text: string) {
  return { content: [{ type: 'text' as const, text }], isError: true }
}

export function buildVdsArrangeTools(mutateDesign: MutateDesign): ToolDef[] {
  const groupElements: ToolDef = {
    name: 'group_elements',
    description:
      'Group two or more elements of the same page into one group (moves, scales and arranges as one, like Ctrl+G in the editor). Locked elements are left out. The group takes the layer of the topmost grouped element. Returns the group element_id.',
    inputSchema: {
      type: 'object',
      properties: {
        design_id: { type: 'string' },
        element_ids: { type: 'array', items: { type: 'string' }, minItems: 2 },
        name: { type: 'string', description: 'Layer name for the group (optional)' },
        page: { type: 'number', minimum: 0, description: 'Default: the page of the first element' },
      },
      required: ['design_id', 'element_ids'],
    },
    handler: async (args) => {
      const ids = [...new Set(strList(args.element_ids))]
      if (ids.length < 2) return errorResult('element_ids needs at least 2 element ids.')
      let problem = ''
      const result = await mutateDesign(str(args.design_id), (pages) => {
        const pageIndex = resolvePage(pages, args.page, ids[0])
        const page = pages[pageIndex]
        if (!page) { problem = `Element "${ids[0]}" was not found in this design.`; return null }
        const missing = ids.filter((id) => !page.elements.some((e) => e.id === id))
        if (missing.length) { problem = `Not on page ${pageIndex}: ${missing.join(', ')}.`; return null }
        // ordem das camadas preservada dentro do grupo; bloqueados ficam de fora (como no editor)
        const children = page.elements.filter((e) => ids.includes(e.id) && !e.locked)
        if (children.length < 2) { problem = 'Fewer than 2 unlocked elements to group.'; return null }
        const childIds = new Set(children.map((c) => c.id))
        const topIndex = Math.max(...page.elements.map((e, i) => (childIds.has(e.id) ? i : -1)))
        const group = createGroupElement(children)
        const name = str(args.name)
        if (name) group.name = name.slice(0, 60)
        const elements: AnyElement[] = []
        page.elements.forEach((e, i) => {
          if (i === topIndex) elements.push(group)
          if (!childIds.has(e.id)) elements.push(e)
        })
        const next = pages.map((p, i) => (i === pageIndex ? { ...p, elements } : p))
        return {
          pages: next,
          summary: {
            group_id: group.id,
            page: pageIndex,
            grouped: children.map((c) => c.id),
            skipped_locked: ids.filter((id) => !childIds.has(id)),
            layers_back_to_front: elements.map(layerInfo),
          },
        }
      })
      return problem && result.isError ? errorResult(problem) : result
    },
  }

  const ungroupElement: ToolDef = {
    name: 'ungroup_element',
    description: 'Ungroup a group back into its elements (they keep their look, including the group rotation) at the same layer position. Returns the released element ids.',
    inputSchema: {
      type: 'object',
      properties: {
        design_id: { type: 'string' },
        element_id: { type: 'string', description: 'The group element id' },
        page: { type: 'number', minimum: 0 },
      },
      required: ['design_id', 'element_id'],
    },
    handler: async (args) => {
      const groupId = str(args.element_id)
      let problem = ''
      const result = await mutateDesign(str(args.design_id), (pages) => {
        const pageIndex = resolvePage(pages, args.page, groupId)
        const page = pages[pageIndex]
        const at = page ? page.elements.findIndex((e) => e.id === groupId) : -1
        if (!page || at === -1) { problem = `Element "${groupId}" was not found in this design.`; return null }
        const g = page.elements[at]
        if (g.type !== 'group') { problem = `Element "${groupId}" is a ${g.type}, not a group.`; return null }
        // filhos no espaço local (sem rotação) do grupo: com rotação, orbitam à volta da origem do grupo
        const rad = ((g.rotation || 0) * Math.PI) / 180
        const cos = Math.cos(rad)
        const sin = Math.sin(rad)
        const released = g.children.map((c) => {
          const child = structuredClone(c)
          if (!rad) return child
          const cx = c.x + c.width / 2 - g.x
          const cy = c.y + c.height / 2 - g.y
          return {
            ...child,
            x: Math.round(g.x + cx * cos - cy * sin - c.width / 2),
            y: Math.round(g.y + cx * sin + cy * cos - c.height / 2),
            rotation: (c.rotation + (g.rotation || 0)) % 360,
          } as AnyElement
        })
        const elements = [...page.elements.slice(0, at), ...released, ...page.elements.slice(at + 1)]
        const next = pages.map((p, i) => (i === pageIndex ? { ...p, elements } : p))
        return { pages: next, summary: { ungrouped: groupId, page: pageIndex, released: released.map((c) => c.id), layers_back_to_front: elements.map(layerInfo) } }
      })
      return problem && result.isError ? errorResult(problem) : result
    },
  }

  const alignElements: ToolDef = {
    name: 'align_elements',
    description:
      'Align elements on their page. align: left | center | right (horizontal) or top | middle | bottom (vertical). relative_to: "page" (default, like the editor: e.g. center a title on the page) or "selection" (line the elements up with each other, using the box around all of them; needs 2+ elements).',
    inputSchema: {
      type: 'object',
      properties: {
        design_id: { type: 'string' },
        element_ids: { type: 'array', items: { type: 'string' }, minItems: 1 },
        align: { type: 'string', enum: [...ALIGN] },
        relative_to: { type: 'string', enum: ['page', 'selection'] },
        page: { type: 'number', minimum: 0 },
      },
      required: ['design_id', 'element_ids', 'align'],
    },
    handler: async (args) => {
      const ids = [...new Set(strList(args.element_ids))]
      const mode = (ALIGN as readonly string[]).includes(str(args.align)) ? (str(args.align) as AlignMode) : null
      if (!ids.length) return errorResult('element_ids needs at least 1 element id.')
      if (!mode) return errorResult(`align must be one of: ${ALIGN.join(', ')}.`)
      const toSelection = str(args.relative_to) === 'selection'
      if (toSelection && ids.length < 2) return errorResult('relative_to "selection" needs 2+ elements; use "page" for one element.')
      let problem = ''
      const result = await mutateDesign(str(args.design_id), (pages, designW, designH) => {
        const pageIndex = resolvePage(pages, args.page, ids[0])
        const page = pages[pageIndex]
        if (!page) { problem = `Element "${ids[0]}" was not found in this design.`; return null }
        const targets = page.elements.filter((e) => ids.includes(e.id))
        const missing = ids.filter((id) => !targets.some((e) => e.id === id))
        if (missing.length) { problem = `Not on page ${pageIndex}: ${missing.join(', ')}.`; return null }
        const { width: pw, height: ph } = sizeOfPage(page, designW, designH)
        // caixa de referência: a página, ou a caixa que envolve todos os elementos
        const box = toSelection
          ? {
              x1: Math.min(...targets.map((e) => e.x)),
              y1: Math.min(...targets.map((e) => e.y)),
              x2: Math.max(...targets.map((e) => e.x + e.width)),
              y2: Math.max(...targets.map((e) => e.y + e.height)),
            }
          : { x1: 0, y1: 0, x2: pw, y2: ph }
        const moved: Array<{ element_id: string; x: number; y: number }> = []
        const elements = page.elements.map((el) => {
          if (!ids.includes(el.id)) return el
          const patch: Partial<AnyElement> = {}
          switch (mode) {
            case 'left': patch.x = box.x1; break
            case 'center': patch.x = Math.round((box.x1 + box.x2 - el.width) / 2); break
            case 'right': patch.x = box.x2 - el.width; break
            case 'top': patch.y = box.y1; break
            case 'middle': patch.y = Math.round((box.y1 + box.y2 - el.height) / 2); break
            case 'bottom': patch.y = box.y2 - el.height; break
          }
          const out = { ...el, ...patch } as AnyElement
          moved.push({ element_id: el.id, x: Math.round(out.x), y: Math.round(out.y) })
          return out
        })
        const next = pages.map((p, i) => (i === pageIndex ? { ...p, elements } : p))
        return { pages: next, summary: { aligned: mode, relative_to: toSelection ? 'selection' : 'page', page: pageIndex, elements: moved } }
      })
      return problem && result.isError ? errorResult(problem) : result
    },
  }

  const distributeElements: ToolDef = {
    name: 'distribute_elements',
    description:
      'Space 3+ elements evenly (equal gaps between their edges), keeping the first and last in place, like the editor "distribute". axis: horizontal (left→right) or vertical (top→bottom).',
    inputSchema: {
      type: 'object',
      properties: {
        design_id: { type: 'string' },
        element_ids: { type: 'array', items: { type: 'string' }, minItems: 3 },
        axis: { type: 'string', enum: ['horizontal', 'vertical'] },
        page: { type: 'number', minimum: 0 },
      },
      required: ['design_id', 'element_ids', 'axis'],
    },
    handler: async (args) => {
      const ids = [...new Set(strList(args.element_ids))]
      if (ids.length < 3) return errorResult('distribute needs at least 3 elements.')
      const axisArg = str(args.axis)
      if (axisArg !== 'horizontal' && axisArg !== 'vertical') return errorResult('axis must be "horizontal" or "vertical".')
      const axis = axisArg === 'horizontal' ? 'x' : 'y'
      let problem = ''
      const result = await mutateDesign(str(args.design_id), (pages) => {
        const pageIndex = resolvePage(pages, args.page, ids[0])
        const page = pages[pageIndex]
        if (!page) { problem = `Element "${ids[0]}" was not found in this design.`; return null }
        const targets = page.elements.filter((e) => ids.includes(e.id))
        const missing = ids.filter((id) => !targets.some((e) => e.id === id))
        if (missing.length) { problem = `Not on page ${pageIndex}: ${missing.join(', ')}.`; return null }
        const positions = distributeEvenly(targets, axis)
        const byId = new Map(targets.map((el, i) => [el.id, positions[i]]))
        const elements = page.elements.map((el) => {
          const pos = byId.get(el.id)
          return pos ? ({ ...el, ...pos } as AnyElement) : el
        })
        const next = pages.map((p, i) => (i === pageIndex ? { ...p, elements } : p))
        return {
          pages: next,
          summary: {
            distributed: axisArg,
            page: pageIndex,
            elements: targets.map((t) => ({ element_id: t.id, ...byId.get(t.id) })),
          },
        }
      })
      return problem && result.isError ? errorResult(problem) : result
    },
  }

  return [groupElements, ungroupElement, alignElements, distributeElements]
}
