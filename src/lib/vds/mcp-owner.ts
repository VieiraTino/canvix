// ─────────────────────────────────────────────────────────────
// [VDS] Alteração local da Viagem de Sonho (patches/vds.patch).
// Dono dos designs e pastas criados pelo MCP.
//
// Sem isto, o que o MCP cria fica sem dono (visível a todas as contas
// e fora das pastas de qualquer uma). Com CANVIX_MCP_OWNER=<username>,
// o MCP cria e organiza em nome dessa conta.
// ─────────────────────────────────────────────────────────────

import { db } from '@/lib/db'

let cached: { username: string; id: string } | null = null

/** id da conta em CANVIX_MCP_OWNER, ou null se não estiver definida ou não existir */
export async function getMcpOwnerId(): Promise<string | null> {
  const username = (process.env.CANVIX_MCP_OWNER ?? '').trim().toLowerCase()
  if (!username) return null
  if (cached && cached.username === username) return cached.id
  const user = await db.user.findUnique({ where: { username }, select: { id: true } })
  if (!user) {
    console.warn(`[vds] CANVIX_MCP_OWNER="${username}" não existe; o MCP cria sem dono`)
    return null
  }
  cached = { username, id: user.id }
  return user.id
}
