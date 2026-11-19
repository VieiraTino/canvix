// ─────────────────────────────────────────────────────────────
// [VDS] Alteração local da Viagem de Sonho.
// Respostas do export_design pequenas o suficiente para uma conversa.
//
// O ChatGPT corta a conversa ("duração máxima") quando uma ferramenta
// devolve megabytes: o PNG em tamanho real em base64 chegava a 2,5 MB e
// o JSON com as fotos e logos embutidos (data URLs) a 5,9 MB.
// - previewJpeg: a pré-visualização para o agente ver (JPEG, 800 px).
//   A imagem em qualidade total continua no export_design_url (link).
// - stripEmbeddedData: troca cada data URL grande por uma nota curta
//   com o tipo e o tamanho; o resto do documento fica igual.
// ─────────────────────────────────────────────────────────────

import { loadSharp } from '@/lib/mcp/tools'

export const PREVIEW_WIDTH = 800
const PREVIEW_QUALITY = 78
const KEEP_DATA_URL_UNDER = 512 // data URLs minúsculos (ícones) ficam

/** placeholder para um data URL omitido, ex.: "omitted:image/png;2350KB" */
function placeholder(dataUrl: string): string {
  const mime = /^data:([^;,]+)/.exec(dataUrl)?.[1] ?? 'data'
  const kb = Math.round((dataUrl.length * 3) / 4 / 1024)
  return `omitted:${mime};${kb}KB`
}

/** cópia profunda com os data URLs grandes trocados por uma nota curta */
export function stripEmbeddedData<T>(value: T): T {
  const walk = (v: unknown): unknown => {
    if (typeof v === 'string') {
      return v.startsWith('data:') && v.length > KEEP_DATA_URL_UNDER ? placeholder(v) : v
    }
    if (Array.isArray(v)) return v.map(walk)
    if (v && typeof v === 'object') {
      const out: Record<string, unknown> = {}
      for (const [k, x] of Object.entries(v as Record<string, unknown>)) out[k] = walk(x)
      return out
    }
    return v
  }
  return walk(value) as T
}

/** SVG de uma página → JPEG leve para pré-visualização (null sem sharp) */
export async function previewJpeg(svg: string, designWidth: number): Promise<Buffer | null> {
  const sharp = await loadSharp()
  if (!sharp) return null
  return sharp(Buffer.from(svg), { density: 96 })
    .resize({ width: Math.min(PREVIEW_WIDTH, designWidth), withoutEnlargement: true })
    .flatten({ background: '#ffffff' })
    .jpeg({ quality: PREVIEW_QUALITY, mozjpeg: true })
    .toBuffer()
}
