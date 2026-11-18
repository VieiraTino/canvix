// ─────────────────────────────────────────────────────────────
// [VDS] Alteração local da Viagem de Sonho.
// Ferramentas MCP dos Uploads: list_uploads (as imagens carregadas na
// biblioteca de Uploads da conta CANVIX_MCP_OWNER) e add_upload (põe
// uma delas num design, como o separador Uploads do editor).
//
// A imagem entra com src "/api/media/<id>", igual ao editor: o ficheiro
// original, sem recomprimir e sem duplicar os bytes no design. O render
// no servidor (export_design / export_design_url) embute-a a partir da
// base de dados.
// ─────────────────────────────────────────────────────────────

import { db } from '@/lib/db'
import { loadSharp, type McpContent, type ToolDef } from '@/lib/mcp/tools'
import { createImageElement } from '@/lib/types'
import { getMcpOwnerId } from './mcp-owner'
import { clamp, fail, intArg, num, ok, sizeOfPage, str, type MutateDesign } from './mcp-shared'

const DEFAULT_LIMIT = 30
const MAX_LIMIT = 100
const MAX_PREVIEWS = 8
const PREVIEW_PX = 256

/** dimensões já com a rotação EXIF aplicada (como o browser mostra a foto) */
async function imageSize(bytes: Buffer): Promise<{ width: number; height: number } | null> {
  const sharp = await loadSharp()
  if (!sharp) return null
  try {
    const meta = await sharp(bytes).metadata()
    if (!meta.width || !meta.height) return null
    const rotated = (meta.orientation ?? 1) >= 5
    return rotated ? { width: meta.height, height: meta.width } : { width: meta.width, height: meta.height }
  } catch {
    return null
  }
}

export function buildVdsUploadTools(mutateDesign: MutateDesign): ToolDef[] {
  const listUploads: ToolDef = {
    name: 'list_uploads',
    description:
      'List the images in the Uploads library of this account (e.g. trip photos uploaded in the editor), newest first: upload_id, file name, format, size. Use an upload_id with add_upload. Set include_previews to also get small previews (first 8) with their pixel size, so you can pick the right photo.',
    inputSchema: {
      type: 'object',
      properties: {
        query: { type: 'string', description: 'Filter by file name (case-insensitive, optional)' },
        limit: { type: 'number', minimum: 1, maximum: MAX_LIMIT, description: `Max items (default ${DEFAULT_LIMIT})` },
        include_previews: { type: 'boolean', description: `Also return ${PREVIEW_PX}px previews of the first ${MAX_PREVIEWS} items. Default false.` },
      },
    },
    handler: async (args) => {
      const ownerId = await getMcpOwnerId()
      if (!ownerId) return fail('Uploads need CANVIX_MCP_OWNER set on the server.')
      const query = str(args.query)
      const limit = clamp(intArg(args.limit) ?? DEFAULT_LIMIT, 1, MAX_LIMIT)
      const rows = await db.media.findMany({
        where: {
          ownerId,
          keepInLibrary: true,
          finalizedAt: { not: null },
          mime: { startsWith: 'image/' },
          ...(query ? { name: { contains: query, mode: 'insensitive' as const } } : {}),
        },
        select: { id: true, name: true, mime: true, size: true, createdAt: true },
        orderBy: { createdAt: 'desc' },
        take: limit,
      })

      const items: Array<Record<string, unknown>> = rows.map((r) => ({
        upload_id: r.id,
        name: r.name ?? 'Upload',
        format: r.mime.replace('image/', ''),
        bytes: r.size,
        uploaded_at: r.createdAt,
      }))

      const previews: McpContent[] = []
      if (args.include_previews === true) {
        const sharp = await loadSharp()
        // um de cada vez: as fotos podem ser grandes, não carregar todas de uma vez
        for (const item of items.slice(0, MAX_PREVIEWS)) {
          const media = await db.media.findUnique({ where: { id: String(item.upload_id) }, select: { bytes: true } })
          if (!media?.bytes || !sharp) continue
          const bytes = Buffer.from(media.bytes)
          const size = await imageSize(bytes)
          if (size) Object.assign(item, size)
          try {
            const png = await sharp(bytes).rotate().resize(PREVIEW_PX, PREVIEW_PX, { fit: 'inside', withoutEnlargement: true }).jpeg({ quality: 70 }).toBuffer()
            previews.push({ type: 'text', text: `Preview of ${item.upload_id} (${item.name}):` })
            previews.push({ type: 'image', data: png.toString('base64'), mimeType: 'image/jpeg' })
          } catch {
            // sem miniatura para este ficheiro
          }
        }
      }

      const summary = ok({
        count: items.length,
        uploads: items,
        note: items.length ? undefined : 'No images in Uploads yet: upload photos in the editor (Uploads tab).',
      })
      return previews.length ? { content: [...summary.content, ...previews] } : summary
    },
  }

  const addUpload: ToolDef = {
    name: 'add_upload',
    description:
      'Place an image from the Uploads library (upload_id from list_uploads) on a design page, at original quality (same as the editor Uploads tab). Default size: 60% of the page width, centred; give width or height to resize keeping the aspect ratio, and x/y to position. as_background: true covers the whole page with the photo, sends it to the back and locks it (editor "Set as background").',
    inputSchema: {
      type: 'object',
      properties: {
        design_id: { type: 'string' },
        upload_id: { type: 'string' },
        page: { type: 'number', minimum: 0, description: '0-based page index (default 0)' },
        x: { type: 'number' },
        y: { type: 'number' },
        width: { type: 'number', description: 'Display width in page px (height follows the aspect ratio)' },
        height: { type: 'number', description: 'Display height in page px, used when width is not given' },
        as_background: { type: 'boolean', description: 'Cover the page, send to back and lock. Default false.' },
      },
      required: ['design_id', 'upload_id'],
    },
    handler: async (args) => {
      const ownerId = await getMcpOwnerId()
      if (!ownerId) return fail('Uploads need CANVIX_MCP_OWNER set on the server.')
      const uploadId = str(args.upload_id)
      const media = await db.media.findFirst({
        where: { id: uploadId, ownerId, finalizedAt: { not: null }, mime: { startsWith: 'image/' } },
        select: { id: true, bytes: true, name: true },
      })
      if (!media?.bytes) return fail(`Upload "${uploadId}" was not found. Call list_uploads for valid upload_id values.`)
      const size = await imageSize(Buffer.from(media.bytes))
      if (!size) return fail(`Upload "${uploadId}" could not be read as an image.`)
      const ratio = size.height / size.width
      const src = `/api/media/${media.id}`

      return mutateDesign(str(args.design_id), (pages, designW, designH) => {
        const pageIndex = clamp(intArg(args.page) ?? 0, 0, pages.length - 1)
        const page = pages[pageIndex]
        if (!page) return null
        const { width: w, height: h } = sizeOfPage(page, designW, designH)
        const asBackground = args.as_background === true

        let dispW: number
        let dispH: number
        let x: number
        let y: number
        if (asBackground) {
          // cobre a página toda, centrada (igual ao "Set as background" do editor)
          const cover = Math.max(w / size.width, h / size.height)
          dispW = Math.round(size.width * cover)
          dispH = Math.round(size.height * cover)
          x = Math.round((w - dispW) / 2)
          y = Math.round((h - dispH) / 2)
        } else {
          const reqW = num(args.width)
          const reqH = num(args.height)
          dispW = reqW !== null ? reqW : reqH !== null ? reqH / ratio : w * 0.6
          dispW = clamp(dispW, 8, w * 2)
          dispH = Math.max(8, dispW * ratio)
          x = clamp(num(args.x) ?? (w - dispW) / 2, -w, w)
          y = clamp(num(args.y) ?? (h - dispH) / 2, -h, h)
        }

        const el = createImageElement(src, size.width, size.height, {
          x,
          y,
          width: Math.round(dispW),
          height: Math.round(dispH),
          ...(asBackground ? { locked: true, name: 'Fundo' } : {}),
        })
        const elements = asBackground ? [el, ...page.elements] : [...page.elements, el]
        const next = pages.map((p, i) => (i === pageIndex ? { ...p, elements } : p))
        return {
          pages: next,
          summary: {
            added: asBackground ? 'background_photo' : 'upload',
            upload_id: media.id,
            element_id: el.id,
            page: pageIndex,
            layer_index: asBackground ? 0 : elements.length - 1,
            width: el.width,
            height: el.height,
            naturalWidth: size.width,
            naturalHeight: size.height,
          },
        }
      })
    },
  }

  return [listUploads, addUpload]
}
