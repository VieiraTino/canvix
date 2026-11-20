// ─────────────────────────────────────────────────────────────
// [VDS] Alteração local da Viagem de Sonho.
// Regras de uso do Canvix para o agente, editadas na app interna
// (Marketing > Agente > "Regras do Canvix") e lidas da api:
//   GET VDS_PROMPT_URL   Authorization: Bearer VDS_PROMPT_TOKEN
//   → { data: { key, version_id, updated_at, body } }
//
// Entregues de duas formas, porque nem todos os clientes MCP usam as
// instructions do initialize:
//   1. acrescentadas às instructions do initialize (withVdsInstructions);
//   2. na ferramenta get_usage_rules (mcp-rules-tools.ts).
// Cache de 5 minutos; se a api falhar, fica a última versão boa. Sem
// variáveis configuradas, nada muda.
// ─────────────────────────────────────────────────────────────

const CACHE_MS = 5 * 60 * 1000
const TIMEOUT_MS = 3000

export interface VdsRules {
  body: string
  versionId: number | null
  updatedAt: string | null
}

let cached: { at: number; rules: VdsRules } | null = null
let inflight: Promise<VdsRules | null> | null = null

function configured(): { url: string; token: string } | null {
  const url = (process.env.VDS_PROMPT_URL ?? '').trim()
  const token = (process.env.VDS_PROMPT_TOKEN ?? '').trim()
  return url && token ? { url, token } : null
}

async function fetchRules(cfg: { url: string; token: string }): Promise<VdsRules | null> {
  try {
    const res = await fetch(cfg.url, {
      headers: { Authorization: `Bearer ${cfg.token}`, Accept: 'application/json' },
      signal: AbortSignal.timeout(TIMEOUT_MS),
      cache: 'no-store',
    })
    if (!res.ok) {
      console.warn(`[vds] regras do Canvix: a api respondeu ${res.status}`)
      return null
    }
    const json = (await res.json()) as { data?: { body?: unknown; version_id?: unknown; updated_at?: unknown } }
    const body = typeof json.data?.body === 'string' ? json.data.body.trim() : ''
    if (!body) return null
    return {
      body,
      versionId: typeof json.data?.version_id === 'number' ? json.data.version_id : null,
      updatedAt: typeof json.data?.updated_at === 'string' ? json.data.updated_at : null,
    }
  } catch (err) {
    console.warn('[vds] regras do Canvix: api indisponível', err instanceof Error ? err.message : err)
    return null
  }
}

/** Regras atuais (cache 5 min; em falha, a última boa; null se nunca houve). */
export async function getVdsRules(): Promise<VdsRules | null> {
  const cfg = configured()
  if (!cfg) return null
  if (cached && Date.now() - cached.at < CACHE_MS) return cached.rules
  if (!inflight) {
    inflight = fetchRules(cfg).finally(() => { inflight = null })
  }
  const fresh = await inflight
  if (fresh) {
    cached = { at: Date.now(), rules: fresh }
    return fresh
  }
  return cached?.rules ?? null
}

/** Texto das regras para o agente, com a versão (para se saber qual usou). */
export function formatVdsRules(rules: VdsRules): string {
  const version = rules.versionId ? ` (versão ${rules.versionId})` : ''
  return `Regras da Viagem de Sonho para usar este Canvix${version} — seguir sempre:\n\n${rules.body}`
}

/** Junta as regras às instructions da resposta do initialize (se houver regras). */
export async function withVdsInstructions<T extends { result?: unknown }>(response: T): Promise<T> {
  const rules = await getVdsRules()
  const result = response.result as { instructions?: unknown } | undefined
  if (!rules || !result || typeof result !== 'object') return response
  const base = typeof result.instructions === 'string' ? result.instructions : ''
  return {
    ...response,
    result: { ...result, instructions: `${base}\n\n${formatVdsRules(rules)}\n\nAs mesmas regras: ferramenta get_usage_rules.` },
  }
}
