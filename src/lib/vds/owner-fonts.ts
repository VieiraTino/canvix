// ─────────────────────────────────────────────────────────────
// [VDS] Alteração local da Viagem de Sonho.
// Fontes carregadas pela conta CANVIX_MCP_OWNER (separador Brand /
// seletor de fontes), para o MCP as aceitar além do catálogo.
//
// O nome da família é igual ao que o editor usa (GET /api/fonts/custom):
// o nome do ficheiro sem extensão, até 60 caracteres. Assim um texto
// criado pelo MCP com "Vogun" abre no editor com a fonte carregada, e o
// render no servidor encontra-a no fontconfig (deploy/fonts).
// ─────────────────────────────────────────────────────────────

import { db } from '@/lib/db'
import { getMcpOwnerId } from './mcp-owner'

const TTL_MS = 30_000

let cache: { at: number; families: string[] } | null = null

function familyOf(name: string | null): string {
  return (name ?? 'Custom font').replace(/\.[^.]+$/, '').slice(0, 60) || 'Custom font'
}

/** Famílias carregadas pela conta do MCP (cache de 30 s). Nunca lança: em erro devolve []. */
export async function loadOwnerFontFamilies(): Promise<string[]> {
  if (cache && Date.now() - cache.at < TTL_MS) return cache.families
  try {
    const ownerId = await getMcpOwnerId()
    if (!ownerId) return []
    const rows = await db.media.findMany({
      where: { mime: { startsWith: 'font/' }, keepInLibrary: true, ownerId },
      select: { name: true },
      orderBy: { createdAt: 'desc' },
      take: 100,
    })
    const families = [...new Set(rows.map((r) => familyOf(r.name)))].sort((a, b) => a.localeCompare(b))
    cache = { at: Date.now(), families }
    return families
  } catch {
    return cache?.families ?? []
  }
}

/**
 * Versão síncrona, para os validadores que não podem esperar (sanitizePatch,
 * normalizeGeneratedDesign). Usa a última leitura: o handler da ferramenta
 * chama loadOwnerFontFamilies() antes.
 */
export function isOwnerFontFamily(name: string): boolean {
  return !!name && !!cache && cache.families.includes(name)
}
