// ─────────────────────────────────────────────────────────────
// [VDS] Alteração local da Viagem de Sonho (patches/vds.patch).
// Ferramentas MCP para pastas: listar, criar e mover designs.
//
// Tudo é feito em nome da conta CANVIX_MCP_OWNER (ver mcp-owner.ts):
// só vê e mexe nas pastas dessa conta, e só move designs dessa conta
// ou sem dono. Nomes e limites seguem as regras de /api/folders.
// ─────────────────────────────────────────────────────────────

import { db } from '@/lib/db'
import { textResult, type ToolDef, type ToolResult } from '@/lib/mcp/tools'
import { getMcpOwnerId } from './mcp-owner'

const MAX_FOLDERS = 50 // igual a /api/folders
const MAX_NAME = 60

function ok(data: unknown): ToolResult {
  return textResult(JSON.stringify(data, null, 2))
}

function fail(message: string): ToolResult {
  return textResult(message, true)
}

function str(v: unknown): string {
  return typeof v === 'string' ? v.trim() : ''
}

/** o mesmo saneamento de /api/folders: sem barras nem "..", até 60 caracteres */
function sanitizeName(raw: unknown): string | null {
  if (typeof raw !== 'string') return null
  const trimmed = raw.replace(/[\\/]|\.\./g, '').trim().slice(0, MAX_NAME)
  return trimmed || null
}

const NO_OWNER = 'Folders need CANVIX_MCP_OWNER set on the server (the account the agent works for).'

export function buildVdsFolderTools(): ToolDef[] {
  const listFolders: ToolDef = {
    name: 'list_folders',
    description:
      "List the user's folders (id, name, number of designs). Folders are flat (no nesting). Use a folder id with move_design_to_folder.",
    inputSchema: { type: 'object', properties: {} },
    handler: async () => {
      const ownerId = await getMcpOwnerId()
      if (!ownerId) return fail(NO_OWNER)
      const folders = await db.folder.findMany({
        where: { ownerId },
        select: {
          id: true,
          name: true,
          _count: { select: { designs: { where: { deletedAt: null } } } },
        },
        orderBy: { createdAt: 'asc' },
        take: 200,
      })
      return ok({
        count: folders.length,
        folders: folders.map((f) => ({ id: f.id, name: f.name, designCount: f._count.designs })),
      })
    },
  }

  const createFolder: ToolDef = {
    name: 'create_folder',
    description:
      'Create a folder for the user (folders cannot be nested). If a folder with the same name already exists, returns it instead of creating a duplicate.',
    inputSchema: {
      type: 'object',
      properties: { name: { type: 'string', description: 'Folder name (max 60 chars, no slashes)' } },
      required: ['name'],
    },
    handler: async (args) => {
      const ownerId = await getMcpOwnerId()
      if (!ownerId) return fail(NO_OWNER)
      const name = sanitizeName(args.name)
      if (!name) return fail('Folder name must not be empty.')
      const existing = await db.folder.findFirst({ where: { ownerId, name }, select: { id: true, name: true } })
      if (existing) return ok({ folder_id: existing.id, name: existing.name, created: false })
      const count = await db.folder.count({ where: { ownerId } })
      if (count >= MAX_FOLDERS) return fail(`Folder limit reached (${MAX_FOLDERS}).`)
      const folder = await db.folder.create({ data: { name, ownerId }, select: { id: true, name: true } })
      return ok({ folder_id: folder.id, name: folder.name, created: true })
    },
  }

  const moveDesignToFolder: ToolDef = {
    name: 'move_design_to_folder',
    description:
      "Move a design into one of the user's folders (folder_id from list_folders / create_folder). Pass folder_id null or \"\" to take it out of its folder.",
    inputSchema: {
      type: 'object',
      properties: {
        design_id: { type: 'string', description: 'Design id (from create_design / search_designs)' },
        folder_id: { type: ['string', 'null'], description: 'Target folder id, or null / "" to remove it from its folder' },
      },
      required: ['design_id'],
    },
    handler: async (args) => {
      const ownerId = await getMcpOwnerId()
      if (!ownerId) return fail(NO_OWNER)
      const designId = str(args.design_id)
      const folderId = str(args.folder_id) || null
      const design = await db.design.findFirst({
        where: { id: designId, deletedAt: null, OR: [{ ownerId }, { ownerId: null }] },
        select: { id: true, name: true },
      })
      if (!design) return fail(`Design "${designId}" was not found.`)
      let folderName: string | null = null
      if (folderId) {
        const folder = await db.folder.findFirst({ where: { id: folderId, ownerId }, select: { name: true } })
        if (!folder) return fail(`Folder "${folderId}" was not found. Call list_folders for valid ids.`)
        folderName = folder.name
      }
      await db.design.update({ where: { id: design.id }, data: { folderId } })
      return ok({ design_id: design.id, name: design.name, folder_id: folderId, folder: folderName })
    },
  }

  return [listFolders, createFolder, moveDesignToFolder]
}
