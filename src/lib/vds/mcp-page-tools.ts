// ─────────────────────────────────────────────────────────────
// [VDS] Alteração local da Viagem de Sonho.
// Ferramentas MCP de páginas (carrosséis): add_page, duplicate_page,
// delete_page e move_page. Mesma lógica do editor-store (addPage,
// duplicatePage, deletePage); a cópia de página gera ids novos para a
// página e para todos os elementos, incluindo os de dentro de grupos.
// ─────────────────────────────────────────────────────────────

import type { ToolDef } from '@/lib/mcp/tools'
import { createPage, uid, type AnyElement, type PageData } from '@/lib/types'
import { clamp, intArg, str, type MutateDesign } from './mcp-shared'

const MAX_PAGES = 30
const HEX = /^#[0-9a-fA-F]{6}$/

/** cópia profunda de um elemento com ids novos (também os filhos de grupos) */
function cloneWithNewIds(el: AnyElement): AnyElement {
  const copy = structuredClone(el) as AnyElement & { children?: AnyElement[]; _m?: string }
  copy.id = uid(el.type)
  delete copy._m
  if (Array.isArray(copy.children)) copy.children = copy.children.map(cloneWithNewIds)
  return copy
}

function pagesSummary(pages: PageData[]) {
  return pages.map((p, i) => ({ index: i, page_id: p.id, elements: p.elements.length }))
}

export function buildVdsPageTools(mutateDesign: MutateDesign): ToolDef[] {
  const addPage: ToolDef = {
    name: 'add_page',
    description:
      'Add an empty page to a design (e.g. the next slide of a carousel). position: 0-based index where the new page goes (default: at the end). background_color optional (#RRGGBB, default white). Returns the new page index and the page list. To reuse a layout, prefer duplicate_page.',
    inputSchema: {
      type: 'object',
      properties: {
        design_id: { type: 'string' },
        position: { type: 'number', minimum: 0 },
        background_color: { type: 'string', description: '#RRGGBB' },
      },
      required: ['design_id'],
    },
    handler: async (args) => {
      let problem = ''
      const result = await mutateDesign(str(args.design_id), (pages) => {
        if (pages.length >= MAX_PAGES) { problem = `A design can have at most ${MAX_PAGES} pages here.`; return null }
        const color = str(args.background_color)
        const page = createPage({ type: 'solid', color: HEX.test(color) ? color : '#FFFFFF' })
        const at = clamp(intArg(args.position) ?? pages.length, 0, pages.length)
        const next = [...pages]
        next.splice(at, 0, page)
        return { pages: next, summary: { added: 'page', page: at, page_id: page.id, pages: pagesSummary(next) } }
      })
      return problem && result.isError ? { content: [{ type: 'text', text: problem }], isError: true } : result
    },
  }

  const duplicatePage: ToolDef = {
    name: 'duplicate_page',
    description:
      'Duplicate a page with all its elements (new ids), e.g. to build the next carousel slide from the same layout. The copy goes right after the original unless position is given. Returns the new page index and the new element ids are in get_design.',
    inputSchema: {
      type: 'object',
      properties: {
        design_id: { type: 'string' },
        page: { type: 'number', minimum: 0, description: 'Page to copy (0-based)' },
        position: { type: 'number', minimum: 0, description: 'Where the copy goes (default: right after the original)' },
      },
      required: ['design_id', 'page'],
    },
    handler: async (args) => {
      let problem = ''
      const result = await mutateDesign(str(args.design_id), (pages) => {
        const from = intArg(args.page)
        if (from === null || !pages[from]) { problem = `Page ${args.page} does not exist (design has ${pages.length}).`; return null }
        if (pages.length >= MAX_PAGES) { problem = `A design can have at most ${MAX_PAGES} pages here.`; return null }
        const original = pages[from]
        const copy: PageData = {
          ...structuredClone(original),
          id: uid('page'),
          elements: original.elements.map(cloneWithNewIds),
        }
        delete (copy as { _pm?: string })._pm
        delete copy.tombstones
        const at = clamp(intArg(args.position) ?? from + 1, 0, pages.length)
        const next = [...pages]
        next.splice(at, 0, copy)
        return { pages: next, summary: { duplicated_page: from, page: at, page_id: copy.id, pages: pagesSummary(next) } }
      })
      return problem && result.isError ? { content: [{ type: 'text', text: problem }], isError: true } : result
    },
  }

  const deletePage: ToolDef = {
    name: 'delete_page',
    description: 'Delete a page and its elements from a design. The last remaining page cannot be deleted.',
    inputSchema: {
      type: 'object',
      properties: {
        design_id: { type: 'string' },
        page: { type: 'number', minimum: 0, description: 'Page to delete (0-based)' },
      },
      required: ['design_id', 'page'],
    },
    handler: async (args) => {
      let problem = ''
      const result = await mutateDesign(str(args.design_id), (pages) => {
        const index = intArg(args.page)
        if (index === null || !pages[index]) { problem = `Page ${args.page} does not exist (design has ${pages.length}).`; return null }
        if (pages.length <= 1) { problem = 'This is the only page; a design needs at least one.'; return null }
        const next = pages.filter((_, i) => i !== index)
        return { pages: next, summary: { deleted_page: index, pages: pagesSummary(next) } }
      })
      return problem && result.isError ? { content: [{ type: 'text', text: problem }], isError: true } : result
    },
  }

  const movePage: ToolDef = {
    name: 'move_page',
    description: 'Move a page to another position (reorder carousel slides). from and to are 0-based page indexes.',
    inputSchema: {
      type: 'object',
      properties: {
        design_id: { type: 'string' },
        from: { type: 'number', minimum: 0 },
        to: { type: 'number', minimum: 0 },
      },
      required: ['design_id', 'from', 'to'],
    },
    handler: async (args) => {
      let problem = ''
      const result = await mutateDesign(str(args.design_id), (pages) => {
        const from = intArg(args.from)
        const to = intArg(args.to)
        if (from === null || !pages[from]) { problem = `Page ${args.from} does not exist (design has ${pages.length}).`; return null }
        if (to === null) { problem = 'to must be a page index.'; return null }
        const target = clamp(to, 0, pages.length - 1)
        const next = [...pages]
        const [page] = next.splice(from, 1)
        next.splice(target, 0, page)
        return { pages: next, summary: { moved_page: from, to: target, pages: pagesSummary(next) } }
      })
      return problem && result.isError ? { content: [{ type: 'text', text: problem }], isError: true } : result
    },
  }

  return [addPage, duplicatePage, deletePage, movePage]
}
