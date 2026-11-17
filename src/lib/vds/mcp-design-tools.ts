// ─────────────────────────────────────────────────────────────
// [VDS] Alteração local da Viagem de Sonho (patches/vds.patch).
// Ferramenta MCP duplicate_design: cópia independente de um design
// (para usar um modelo sem lhe tocar), já na pasta pedida.
//
// O original só é lido. A cópia fica na conta CANVIX_MCP_OWNER, com
// source "duplicate:<id original>" (a convenção do próprio Canvix) e,
// se pedido, logo dentro da pasta, antes de qualquer edição.
// ─────────────────────────────────────────────────────────────

import { db } from '@/lib/db'
import { textResult, type ToolDef, type ToolResult } from '@/lib/mcp/tools'
import { getMcpOwnerId } from './mcp-owner'

const MAX_NAME = 80 // igual ao create_design

function ok(data: unknown): ToolResult {
  return textResult(JSON.stringify(data, null, 2))
}

function fail(message: string): ToolResult {
  return textResult(message, true)
}

function str(v: unknown): string {
  return typeof v === 'string' ? v.trim() : ''
}

export function buildVdsDesignTools(): ToolDef[] {
  const duplicateDesign: ToolDef = {
    name: 'duplicate_design',
    description:
      'Make an independent copy of a design (e.g. a brand template) without changing the original, and return the new design_id. Optionally file the copy straight into a folder (folder_id from list_folders, or folder_name of an existing folder such as "ChatGPT") before any edit. Edit the copy, never the original.',
    inputSchema: {
      type: 'object',
      properties: {
        design_id: { type: 'string', description: 'Original design id (from search_designs)' },
        name: { type: 'string', description: 'Name of the copy (default "<original name> (cópia)")' },
        folder_id: { type: 'string', description: 'Folder to put the copy in (from list_folders). Optional.' },
        folder_name: { type: 'string', description: 'Exact name of an existing folder, used when folder_id is not given. Optional.' },
      },
      required: ['design_id'],
    },
    handler: async (args) => {
      const ownerId = await getMcpOwnerId()
      const designId = str(args.design_id)
      const original = await db.design.findFirst({
        where: { id: designId, deletedAt: null, ...(ownerId ? { OR: [{ ownerId }, { ownerId: null }] } : {}) },
        select: { id: true, name: true, width: true, height: true, pages: true, thumbnail: true },
      })
      if (!original) return fail(`Design "${designId}" was not found.`)

      // pasta de destino: tem de ser da conta do MCP
      let folder: { id: string; name: string } | null = null
      const folderId = str(args.folder_id)
      const folderName = str(args.folder_name)
      if (folderId || folderName) {
        if (!ownerId) return fail('Folders need CANVIX_MCP_OWNER set on the server.')
        folder = await db.folder.findFirst({
          where: folderId ? { id: folderId, ownerId } : { name: folderName, ownerId },
          select: { id: true, name: true },
        })
        if (!folder) {
          return fail(`Folder "${folderId || folderName}" was not found. Call list_folders, or create_folder first.`)
        }
      }

      const name = (str(args.name) || `${original.name} (cópia)`).slice(0, MAX_NAME)
      const copy = await db.design.create({
        data: {
          name,
          width: original.width,
          height: original.height,
          pages: (original.pages ?? []) as object,
          thumbnail: original.thumbnail,
          source: `duplicate:${original.id}`,
          ownerId,
          folderId: folder?.id ?? null,
        },
        select: { id: true, name: true, width: true, height: true },
      })
      return ok({
        design_id: copy.id,
        name: copy.name,
        width: copy.width,
        height: copy.height,
        duplicated_from: original.id,
        folder_id: folder?.id ?? null,
        folder: folder?.name ?? null,
      })
    },
  }

  return [duplicateDesign]
}
