// ─────────────────────────────────────────────────────────────
// [VDS] Alteração local da Viagem de Sonho (patches/vds.patch).
// Ferramenta MCP export_design_url: devolve links temporários e
// assinados para o PNG/JPG de páginas de um design, para outra
// ferramenta (ex.: o MCP do TryPost) descarregar a imagem por URL.
// O render acontece quando o link é aberto (export-link.ts).
// ─────────────────────────────────────────────────────────────

import type { NextRequest } from 'next/server'
import { db } from '@/lib/db'
import { textResult, type ToolDef, type ToolResult } from '@/lib/mcp/tools'
import { getMcpOwnerId } from './mcp-owner'
import {
  createExportLink,
  publicOrigin,
  DEFAULT_TTL_MINUTES,
  MAX_TTL_MINUTES,
  type ExportFormat,
} from './export-link'

const MAX_PAGES = 10

function ok(data: unknown): ToolResult {
  return textResult(JSON.stringify(data, null, 2))
}

function fail(message: string): ToolResult {
  return textResult(message, true)
}

export function buildVdsExportTools(req: Pick<NextRequest, 'headers'>): ToolDef[] {
  const exportDesignUrl: ToolDef = {
    name: 'export_design_url',
    description:
      'Export design pages as PNG or JPG and return temporary signed public URLs (valid 15 min by default, max 60) — for handing the image to another tool by URL, e.g. TryPost attach-media-from-url / create-post media. Rendered server-side with the brand fonts installed on the server; photos are embedded. page: 0-based index, or "all" for every page (carousel, max 10). For an image inside this chat use export_design instead.',
    inputSchema: {
      type: 'object',
      properties: {
        design_id: { type: 'string', description: 'Design id (from create_design / search_designs)' },
        format: { type: 'string', enum: ['png', 'jpg'], description: 'png (default) or jpg (smaller, no transparency)' },
        page: { type: ['number', 'string'], description: '0-based page index or "all" (default 0)' },
        expires_minutes: { type: 'number', minimum: 1, maximum: MAX_TTL_MINUTES, description: `Link lifetime in minutes (default ${DEFAULT_TTL_MINUTES})` },
      },
      required: ['design_id'],
    },
    handler: async (args) => {
      const designId = typeof args.design_id === 'string' ? args.design_id.trim() : ''
      const format: ExportFormat = args.format === 'jpg' ? 'jpg' : 'png'
      const ttlRaw = typeof args.expires_minutes === 'number' ? Math.round(args.expires_minutes) : DEFAULT_TTL_MINUTES
      const ttl = Math.min(MAX_TTL_MINUTES, Math.max(1, ttlRaw))

      const ownerId = await getMcpOwnerId()
      const design = await db.design.findFirst({
        where: { id: designId, deletedAt: null, ...(ownerId ? { OR: [{ ownerId }, { ownerId: null }] } : {}) },
        select: { id: true, name: true, width: true, height: true, pages: true },
      })
      if (!design) return fail(`Design "${designId}" was not found.`)
      const pageCount = Array.isArray(design.pages) ? design.pages.length : 0
      if (!pageCount) return fail('This design has no pages yet — add elements first.')

      let indices: number[]
      if (args.page === 'all') {
        indices = Array.from({ length: Math.min(pageCount, MAX_PAGES) }, (_, i) => i)
      } else {
        const n = typeof args.page === 'number' ? args.page : Number.parseInt(String(args.page ?? '0'), 10)
        const index = Number.isFinite(n) ? Math.round(n) : 0
        if (index < 0 || index >= pageCount) return fail(`Page ${index} does not exist (design has ${pageCount}).`)
        indices = [index]
      }

      const origin = publicOrigin(req.headers)
      const links = indices.map((i) => ({ page: i, ...createExportLink(origin, design.id, i, format, ttl) }))
      if (links.some((l) => !('url' in l) || !l.url)) {
        return fail('Export links need CANVIX_MCP_TOKEN set on the server.')
      }
      return ok({
        design_id: design.id,
        name: design.name,
        width: design.width,
        height: design.height,
        format,
        pages: links,
        note: 'URLs are public until they expire; render happens when the URL is fetched.',
      })
    },
  }

  return [exportDesignUrl]
}
