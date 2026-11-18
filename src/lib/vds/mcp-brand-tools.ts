// ─────────────────────────────────────────────────────────────
// [VDS] Alteração local da Viagem de Sonho.
// Ferramentas MCP da Brand: list_brand_assets (cores, fontes e logos dos
// brand kits da conta CANVIX_MCP_OWNER) e add_brand_asset (põe um logo
// num design com o ficheiro original, sem recomprimir).
//
// Os logos estão no BrandKitRecord.logos como data URLs do ficheiro tal
// como foi carregado no separador Brand. O add_brand_asset usa esse data
// URL tal e qual como src da imagem: a qualidade é a do original.
// ─────────────────────────────────────────────────────────────

import { db } from '@/lib/db'
import { loadSharp, textResult, type McpContent, type ToolDef, type ToolResult } from '@/lib/mcp/tools'
import { createImageElement, type PageData } from '@/lib/types'
import { getMcpOwnerId } from './mcp-owner'

type MutateDesign = (
  designId: string,
  fn: (pages: PageData[], width: number, height: number) => { pages: PageData[]; summary: Record<string, unknown> } | null
) => Promise<ToolResult>

const MAX_PREVIEWS = 8
const PREVIEW_PX = 256

function ok(data: unknown): ToolResult {
  return textResult(JSON.stringify(data, null, 2))
}

function fail(message: string): ToolResult {
  return textResult(message, true)
}

function str(v: unknown): string {
  return typeof v === 'string' ? v.trim() : ''
}

function num(v: unknown): number | null {
  return typeof v === 'number' && Number.isFinite(v) ? v : null
}

function strList(v: unknown): string[] {
  return Array.isArray(v) ? v.filter((x): x is string => typeof x === 'string') : []
}

/** Separa um data URL em tipo e bytes. Devolve null se não for base64 de imagem. */
function decodeDataUrl(src: string): { mime: string; buffer: Buffer } | null {
  const m = /^data:(image\/[a-z0-9.+-]+);base64,([\s\S]*)$/i.exec(src)
  if (!m) return null
  try {
    return { mime: m[1].toLowerCase(), buffer: Buffer.from(m[2], 'base64') }
  } catch {
    return null
  }
}

interface LogoInfo {
  asset_id: string
  kit_id: string
  kind: 'logo'
  index: number
  format: string
  width: number | null
  height: number | null
  bytes: number | null
  usable: boolean
}

async function describeLogo(kitId: string, index: number, src: string): Promise<{ info: LogoInfo; buffer: Buffer | null }> {
  const decoded = decodeDataUrl(src)
  const base = { asset_id: `logo:${kitId}:${index}`, kit_id: kitId, kind: 'logo' as const, index }
  if (!decoded) {
    return { info: { ...base, format: 'unknown', width: null, height: null, bytes: null, usable: false }, buffer: null }
  }
  let width: number | null = null
  let height: number | null = null
  const sharp = await loadSharp()
  if (sharp) {
    try {
      const meta = await sharp(decoded.buffer).metadata()
      width = meta.width ?? null
      height = meta.height ?? null
    } catch {
      // ficheiro que o sharp não lê: fica sem dimensões
    }
  }
  return {
    info: {
      ...base,
      format: decoded.mime.replace('image/', ''),
      width,
      height,
      bytes: decoded.buffer.length,
      usable: width !== null && height !== null,
    },
    buffer: decoded.buffer,
  }
}

/** Brand kits da conta do MCP, o mais recente primeiro (é o que o editor abre). */
async function ownerKits() {
  const ownerId = await getMcpOwnerId()
  if (!ownerId) return null
  return db.brandKitRecord.findMany({
    where: { ownerId },
    orderBy: { updatedAt: 'desc' },
    select: { id: true, name: true, colors: true, palettes: true, headingFont: true, bodyFont: true, logos: true, updatedAt: true },
  })
}

export function buildVdsBrandTools(mutateDesign: MutateDesign): ToolDef[] {
  const listBrandAssets: ToolDef = {
    name: 'list_brand_assets',
    description:
      'List the Brand kit assets: colors, palettes, heading/body fonts and logos (asset_id, format, original pixel size). Use an asset_id with add_brand_asset to place a logo in a design at original quality. The first kit is the active one in the editor. Set include_previews to also get small preview images of the logos so you can see which is which.',
    inputSchema: {
      type: 'object',
      properties: {
        include_previews: { type: 'boolean', description: `Also return a ${PREVIEW_PX}px preview image of each logo (max ${MAX_PREVIEWS}). Default false.` },
      },
    },
    handler: async (args) => {
      const kits = await ownerKits()
      if (kits === null) return fail('Brand assets need CANVIX_MCP_OWNER set on the server.')
      const wantPreviews = args.include_previews === true
      const previews: McpContent[] = []
      const sharp = wantPreviews ? await loadSharp() : null

      const out: Array<Record<string, unknown>> = []
      for (const kit of kits) {
        const logos: LogoInfo[] = []
        const srcs = strList(kit.logos)
        for (let i = 0; i < srcs.length; i++) {
          const { info, buffer } = await describeLogo(kit.id, i, srcs[i])
          logos.push(info)
          if (sharp && buffer && info.usable && previews.length < MAX_PREVIEWS * 2) {
            try {
              // miniatura só para o agente ver; o design recebe sempre o original
              const png = await sharp(buffer).resize(PREVIEW_PX, PREVIEW_PX, { fit: 'inside', withoutEnlargement: true }).png().toBuffer()
              previews.push({ type: 'text', text: `Preview of ${info.asset_id}:` })
              previews.push({ type: 'image', data: png.toString('base64'), mimeType: 'image/png' })
            } catch {
              // sem miniatura para este logo
            }
          }
        }
        out.push({
          kit_id: kit.id,
          name: kit.name,
          updated_at: kit.updatedAt,
          colors: strList(kit.colors),
          palettes: Array.isArray(kit.palettes) ? (kit.palettes as unknown[]).map(strList) : [],
          heading_font: kit.headingFont,
          body_font: kit.bodyFont,
          logos,
        })
      }

      const summary = ok({
        count: out.length,
        kits: out,
        note: out.length
          ? 'asset_id values follow the logo order in the Brand tab: list again before add_brand_asset if the kit may have changed.'
          : 'No brand kit yet: open any design, Brand tab, and add colors/logos.',
      })
      return previews.length ? { content: [...summary.content, ...previews] } : summary
    },
  }

  const addBrandAsset: ToolDef = {
    name: 'add_brand_asset',
    description:
      'Place a Brand kit logo (asset_id from list_brand_assets) on a design page using the original uploaded file, no recompression, square corners. Size defaults to 25% of the page width (never upscaled past the original); give width or height to resize keeping the aspect ratio, and x/y for position (default centred).',
    inputSchema: {
      type: 'object',
      properties: {
        design_id: { type: 'string' },
        asset_id: { type: 'string', description: 'e.g. "logo:<kit_id>:0" from list_brand_assets' },
        page: { type: 'number', minimum: 0, description: '0-based page index (default 0)' },
        x: { type: 'number' },
        y: { type: 'number' },
        width: { type: 'number', description: 'Display width in page px (height follows the aspect ratio)' },
        height: { type: 'number', description: 'Display height in page px, used when width is not given' },
      },
      required: ['design_id', 'asset_id'],
    },
    handler: async (args) => {
      const designId = str(args.design_id)
      const assetId = str(args.asset_id)
      const m = /^logo:([^:]+):(\d{1,2})$/.exec(assetId)
      if (!m) return fail(`asset_id "${assetId}" is not valid. Call list_brand_assets and use one of its asset_id values.`)
      const [, kitId, indexRaw] = m
      const index = Number(indexRaw)

      const kits = await ownerKits()
      if (kits === null) return fail('Brand assets need CANVIX_MCP_OWNER set on the server.')
      const kit = kits.find((k) => k.id === kitId)
      const src = kit ? strList(kit.logos)[index] : undefined
      if (!kit || !src) return fail(`Brand asset "${assetId}" was not found. Call list_brand_assets again (the kit may have changed).`)

      const { info } = await describeLogo(kit.id, index, src)
      if (!info.usable || !info.width || !info.height) {
        return fail(`Brand asset "${assetId}" could not be read (format ${info.format}).`)
      }
      const natW = info.width
      const natH = info.height
      const ratio = natH / natW

      return mutateDesign(designId, (pages, w, h) => {
        const pageIndex = Math.min(Math.max(0, Math.round(num(args.page) ?? 0)), pages.length - 1)
        if (!pages[pageIndex]) return null
        const reqW = num(args.width)
        const reqH = num(args.height)
        let dispW: number
        if (reqW !== null) dispW = reqW
        else if (reqH !== null) dispW = reqH / ratio
        else dispW = Math.min(w * 0.25, natW) // igual ao separador Brand
        dispW = Math.min(Math.max(8, dispW), w * 2)
        const dispH = Math.max(8, dispW * ratio)
        const x = num(args.x) ?? (w - dispW) / 2
        const y = num(args.y) ?? (h - dispH) / 2

        const el = createImageElement(src, natW, natH, {
          x: Math.min(Math.max(x, -w), w),
          y: Math.min(Math.max(y, -h), h),
          width: Math.round(dispW),
          height: Math.round(dispH),
          radius: 0,
        })
        const next = pages.map((p, i) => (i === pageIndex ? { ...p, elements: [...p.elements, el] } : p))
        return {
          pages: next,
          summary: {
            added: 'brand_logo',
            asset_id: assetId,
            element_id: el.id,
            page: pageIndex,
            width: el.width,
            height: el.height,
            naturalWidth: natW,
            naturalHeight: natH,
            format: info.format,
          },
        }
      })
    },
  }

  return [listBrandAssets, addBrandAsset]
}
