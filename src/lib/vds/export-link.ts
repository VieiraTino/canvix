// ─────────────────────────────────────────────────────────────
// [VDS] Alteração local da Viagem de Sonho (patches/vds.patch).
// Links temporários e assinados para a imagem de um design, e o
// render no servidor que os serve (usado para mandar a imagem ao
// TryPost por URL).
//
// - O link leva design, página, formato e validade, assinados com
//   HMAC-SHA256. A chave deriva do CANVIX_MCP_TOKEN: sem MCP ligado,
//   não há links. Mudar o token invalida todos os links.
// - O render embute as fotos (media do Canvix e https públicos, com
//   o filtro SSRF do MCP) antes de rasterizar: o sharp/librsvg não
//   descarrega imagens sozinho, e sem isto a foto sai em branco.
// ─────────────────────────────────────────────────────────────

import { createHash, createHmac, timingSafeEqual } from 'node:crypto'
import { db } from '@/lib/db'
import { exportPageToSVG } from '@/lib/svg-export'
import { loadSharp } from '@/lib/mcp/tools'
import { safeFetch } from '@/lib/mcp/ssrf-guard'
import type { PageData } from '@/lib/types'

export type ExportFormat = 'png' | 'jpg'

export const DEFAULT_TTL_MINUTES = 15
export const MAX_TTL_MINUTES = 60
const MAX_IMAGE_BYTES = 8 * 1024 * 1024 // por imagem embutida (igual ao export do editor)
const FETCH_TIMEOUT_MS = 10_000
const MAX_OUTPUT_WIDTH = 4000

function signingKey(): Buffer | null {
  const token = (process.env.CANVIX_MCP_TOKEN ?? '').trim()
  if (!token) return null
  return createHash('sha256').update(`vds-export-link:${token}`).digest()
}

function payloadOf(designId: string, page: number, format: ExportFormat, exp: number): string {
  return `${designId}.${page}.${format}.${exp}`
}

function sign(key: Buffer, payload: string): string {
  return createHmac('sha256', key).update(payload).digest('base64url')
}

/** URL pública da instância: CANVIX_PUBLIC_URL, senão o Host do pedido */
export function publicOrigin(headers: Pick<Headers, 'get'>): string {
  const fromEnv = (process.env.CANVIX_PUBLIC_URL ?? '').trim().replace(/\/+$/, '')
  if (fromEnv) return fromEnv
  const host = headers.get('x-forwarded-host') ?? headers.get('host') ?? 'localhost:3000'
  const proto = headers.get('x-forwarded-proto') ?? (host.startsWith('localhost') || host.startsWith('127.') ? 'http' : 'https')
  return `${proto}://${host}`
}

/** cria o link assinado; null se o MCP não tiver token (sem chave) */
export function createExportLink(
  origin: string,
  designId: string,
  page: number,
  format: ExportFormat,
  ttlMinutes: number,
): { url: string; expiresAt: string } | null {
  const key = signingKey()
  if (!key) return null
  const exp = Math.floor(Date.now() / 1000) + ttlMinutes * 60
  const sig = sign(key, payloadOf(designId, page, format, exp))
  const url = `${origin}/api/vds/export/${encodeURIComponent(designId)}/${page}.${format}?exp=${exp}&sig=${sig}`
  return { url, expiresAt: new Date(exp * 1000).toISOString() }
}

/** valida assinatura e validade; o erro é deliberadamente genérico */
export function verifyExportLink(designId: string, page: number, format: ExportFormat, exp: number, sig: string): boolean {
  const key = signingKey()
  if (!key || !Number.isFinite(exp) || !sig) return false
  const now = Math.floor(Date.now() / 1000)
  if (exp < now || exp > now + MAX_TTL_MINUTES * 60 + 60) return false
  const expected = Buffer.from(sign(key, payloadOf(designId, page, format, exp)))
  const given = Buffer.from(sig)
  return expected.length === given.length && timingSafeEqual(expected, given)
}

// ── render ───────────────────────────────────────────────────

/** todos os src de imagens (elementos, filhos de grupos, molduras) */
function collectImageSrcs(value: unknown, out: Set<string>): void {
  if (!value || typeof value !== 'object') return
  if (Array.isArray(value)) {
    value.forEach((v) => collectImageSrcs(v, out))
    return
  }
  const v = value as Record<string, unknown>
  if (typeof v.src === 'string' && (v.src.startsWith('/api/media/') || /^https:\/\//i.test(v.src))) out.add(v.src)
  for (const key of ['elements', 'children'] as const) {
    if (Array.isArray(v[key])) collectImageSrcs(v[key], out)
  }
}

function replaceImageSrcs(value: unknown, map: Map<string, string>): void {
  if (!value || typeof value !== 'object') return
  if (Array.isArray(value)) {
    value.forEach((v) => replaceImageSrcs(v, map))
    return
  }
  const v = value as Record<string, unknown>
  if (typeof v.src === 'string' && map.has(v.src)) v.src = map.get(v.src)
  for (const key of ['elements', 'children'] as const) {
    if (Array.isArray(v[key])) replaceImageSrcs(v[key], map)
  }
}

async function mediaToDataUrl(src: string): Promise<string | null> {
  const id = src.slice('/api/media/'.length).split(/[/?#]/)[0]
  if (!id) return null
  const media = await db.media.findUnique({ where: { id }, select: { bytes: true, mime: true } })
  if (!media?.bytes || !media.mime?.startsWith('image/')) return null
  const bytes = Buffer.from(media.bytes)
  if (bytes.length > MAX_IMAGE_BYTES) return null
  return `data:${media.mime};base64,${bytes.toString('base64')}`
}

async function remoteToDataUrl(src: string): Promise<string | null> {
  const res = await safeFetch(src, { signal: AbortSignal.timeout(FETCH_TIMEOUT_MS) })
  if (!res.ok) return null
  const mime = (res.headers.get('content-type') ?? '').split(';')[0].trim()
  if (!mime.startsWith('image/')) return null
  const bytes = Buffer.from(await res.arrayBuffer())
  if (bytes.length > MAX_IMAGE_BYTES) return null
  return `data:${mime};base64,${bytes.toString('base64')}`
}

/** cópia da página com as imagens embutidas (as que falharem ficam como estavam) */
async function inlinePageImages(page: PageData): Promise<PageData> {
  const copy = structuredClone(page)
  const srcs = new Set<string>()
  collectImageSrcs(copy, srcs)
  if (!srcs.size) return copy
  const map = new Map<string, string>()
  await Promise.all(
    Array.from(srcs).map(async (src) => {
      try {
        const data = src.startsWith('/api/media/') ? await mediaToDataUrl(src) : await remoteToDataUrl(src)
        if (data) map.set(src, data)
      } catch {
        // imagem indisponível: fica o src original (sai em branco, como no export_design)
      }
    }),
  )
  replaceImageSrcs(copy, map)
  return copy
}

/** gera o PNG/JPG de uma página no servidor, com as fotos embutidas */
export async function renderDesignPage(
  design: { width: number; height: number; pages: unknown },
  pageIndex: number,
  format: ExportFormat,
): Promise<Buffer | null> {
  const sharp = await loadSharp()
  if (!sharp) return null
  const pages = (Array.isArray(design.pages) ? design.pages : []) as PageData[]
  const page = pages[pageIndex]
  if (!page) return null
  const inlined = await inlinePageImages(page)
  const svg = exportPageToSVG(inlined, design.width, design.height)
  const width = Math.min(MAX_OUTPUT_WIDTH, design.width)
  const base = sharp(Buffer.from(svg), { density: 96 }).resize({ width, withoutEnlargement: true })
  return format === 'jpg'
    ? base.flatten({ background: '#ffffff' }).jpeg({ quality: 90, mozjpeg: true }).toBuffer()
    : base.png().toBuffer()
}
