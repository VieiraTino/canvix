// ─────────────────────────────────────────────────────────────
// [VDS] Alteração local da Viagem de Sonho.
// CANVIX_MCP_WRITE_FOLDER: a única pasta onde o MCP pode escrever.
//
// Com a variável definida (nome ou id de uma pasta da conta
// CANVIX_MCP_OWNER, ex.: "ChatGPT"):
// - editar, comentar ou redimensionar no sítio: só designs dessa pasta;
// - criar, gerar, duplicar ou redimensionar para cópia: o design novo
//   nasce nessa pasta (não pode ir para outra);
// - criar pastas e mover designs: recusado;
// - ler, pesquisar, exportar e usar como origem de cópia: livre.
// Se a pasta não existir, as escritas são recusadas (falha fechada).
// Sem a variável, tudo como antes.
// ─────────────────────────────────────────────────────────────

import { db } from '@/lib/db'
import { getMcpOwnerId } from './mcp-owner'

const CACHE_MS = 60_000

export type WriteFolder = { id: string; name: string }
type Resolved = { kind: 'off' } | { kind: 'folder'; folder: WriteFolder } | { kind: 'missing'; ref: string }

let cache: { at: number; ref: string; value: Resolved } | null = null

async function resolve(): Promise<Resolved> {
  const ref = (process.env.CANVIX_MCP_WRITE_FOLDER ?? '').trim()
  if (!ref) return { kind: 'off' }
  if (cache && cache.ref === ref && Date.now() - cache.at < CACHE_MS) return cache.value
  const ownerId = await getMcpOwnerId()
  const folder = ownerId
    ? await db.folder.findFirst({
        where: { ownerId, OR: [{ id: ref }, { name: ref }] },
        select: { id: true, name: true },
      })
    : null
  const value: Resolved = folder ? { kind: 'folder', folder } : { kind: 'missing', ref }
  if (!folder) console.warn(`[vds] CANVIX_MCP_WRITE_FOLDER="${ref}" não existe: escritas do MCP recusadas`)
  cache = { at: Date.now(), ref, value }
  return value
}

function missingMessage(ref: string): string {
  return `Writing is restricted to the folder "${ref}", which does not exist for this account. Nothing was changed; ask the user to check the server setting CANVIX_MCP_WRITE_FOLDER.`
}

/** A pasta de escrita, ou null se a restrição estiver desligada. */
export async function writeFolder(): Promise<WriteFolder | null | { error: string }> {
  const r = await resolve()
  if (r.kind === 'off') return null
  if (r.kind === 'missing') return { error: missingMessage(r.ref) }
  return r.folder
}

/** Mensagem de recusa se o design não puder ser alterado; null se puder. */
export async function writeGuard(designId: string): Promise<string | null> {
  const r = await resolve()
  if (r.kind === 'off') return null
  if (r.kind === 'missing') return missingMessage(r.ref)
  const design = await db.design.findFirst({ where: { id: designId, deletedAt: null }, select: { folderId: true } })
  if (!design) return null // o próprio fluxo responde "não encontrado"
  if (design.folderId === r.folder.id) return null
  return `Design "${designId}" is outside the folder "${r.folder.name}", where all edits must happen. Nothing was changed. To work from it, call duplicate_design (the copy is created in "${r.folder.name}") and edit the copy.`
}

/** Pasta onde nasce um design novo: { folderId } (null = sem restrição) ou { error }. */
export async function newDesignFolder(requested?: string | null): Promise<{ folderId: string | null } | { error: string }> {
  const r = await resolve()
  if (r.kind === 'off') return { folderId: requested ?? null }
  if (r.kind === 'missing') return { error: missingMessage(r.ref) }
  if (requested && requested !== r.folder.id) {
    return { error: `New designs can only be created in the folder "${r.folder.name}". Nothing was created; omit the folder or use "${r.folder.name}".` }
  }
  return { folderId: r.folder.id }
}

/** Recusa de ferramentas de pastas (criar, mover) quando a restrição está ligada. */
export async function folderChangesBlocked(): Promise<string | null> {
  const r = await resolve()
  if (r.kind === 'off') return null
  const name = r.kind === 'folder' ? r.folder.name : r.ref
  return `Folders are fixed on this server: all work happens in "${name}" and new designs are created there automatically. Creating folders and moving designs is not allowed. Nothing was changed.`
}
