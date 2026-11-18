// ─────────────────────────────────────────────────────────────
// [VDS] Alteração local da Viagem de Sonho.
// Ferramenta MCP resize_design: muda o tamanho de um design com o
// "magic resize" do editor (magicRelayoutPages: os elementos escalam e
// mantêm a posição relativa). Por omissão cria uma CÓPIA no tamanho
// novo, na mesma pasta, e o original fica intacto (ex.: post → story).
//
// Escreve ela própria (o mutateDesign só grava páginas, não o tamanho):
// update/create do Design e o evento pages:replace com width/height,
// que o editor aberto aplica (applyRemoteOp).
// ─────────────────────────────────────────────────────────────

import { db } from '@/lib/db'
import type { ToolDef } from '@/lib/mcp/tools'
import { magicRelayoutPages } from '@/lib/magic'
import type { PageData } from '@/lib/types'
import { getMcpOwnerId } from './mcp-owner'
import { fail, intArg, ok, str } from './mcp-shared'

const AGENT_ACTOR = 'agent:mcp' // igual ao tools.ts
const MIN_PX = 32
const MAX_PX = 8000
const MAX_NAME = 80

const PRESETS: Record<string, { width: number; height: number; label: string }> = {
  instagram_square: { width: 1080, height: 1080, label: 'Instagram post 1:1' },
  instagram_portrait: { width: 1080, height: 1350, label: 'Instagram post 4:5' },
  story: { width: 1080, height: 1920, label: 'Instagram/Facebook story, Reels 9:16' },
  facebook_post: { width: 1200, height: 630, label: 'Facebook / link post 1.91:1' },
  linkedin_post: { width: 1200, height: 627, label: 'LinkedIn post' },
  youtube_thumbnail: { width: 1280, height: 720, label: 'YouTube thumbnail 16:9' },
  a4_portrait: { width: 2480, height: 3508, label: 'A4 portrait (300 dpi)' },
}

export function buildVdsResizeTools(): ToolDef[] {
  const resizeDesign: ToolDef = {
    name: 'resize_design',
    description:
      `Resize a design to a new canvas size with the editor "magic resize" (elements scale and keep their relative position; check the result and adjust with update_element). Give width+height or a preset: ${Object.entries(PRESETS).map(([k, p]) => `${k} (${p.width}x${p.height})`).join(', ')}. By default creates a COPY at the new size in the same folder and leaves the original untouched (e.g. feed post → story); as_copy: false resizes the design itself.`,
    inputSchema: {
      type: 'object',
      properties: {
        design_id: { type: 'string' },
        preset: { type: 'string', enum: Object.keys(PRESETS) },
        width: { type: 'number', minimum: MIN_PX, maximum: MAX_PX },
        height: { type: 'number', minimum: MIN_PX, maximum: MAX_PX },
        as_copy: { type: 'boolean', description: 'Default true: new design at the new size, original untouched' },
        name: { type: 'string', description: 'Name of the copy (default "<original> (WxH)")' },
      },
      required: ['design_id'],
    },
    handler: async (args) => {
      const preset = PRESETS[str(args.preset)]
      const width = preset?.width ?? intArg(args.width)
      const height = preset?.height ?? intArg(args.height)
      if (!width || !height) return fail('Give a preset, or both width and height.')
      if (width < MIN_PX || height < MIN_PX || width > MAX_PX || height > MAX_PX) {
        return fail(`width and height must be between ${MIN_PX} and ${MAX_PX} px.`)
      }

      const ownerId = await getMcpOwnerId()
      const designId = str(args.design_id)
      const original = await db.design.findFirst({
        where: { id: designId, deletedAt: null, ...(ownerId ? { OR: [{ ownerId }, { ownerId: null }] } : {}) },
        select: { id: true, name: true, width: true, height: true, pages: true, folderId: true, ownerId: true },
      })
      if (!original) return fail(`Design "${designId}" was not found.`)
      const pages = (Array.isArray(original.pages) ? original.pages : []) as unknown as PageData[]
      if (!pages.length) return fail('This design has no pages yet.')
      if (original.width === width && original.height === height) return fail(`The design is already ${width}x${height}.`)

      // os overrides de tamanho por página deixam de fazer sentido no tamanho novo
      const relaid = magicRelayoutPages(structuredClone(pages), original.width, original.height, width, height).map((p) => {
        const { width: _w, height: _h, ...rest } = p as PageData & { width?: number; height?: number }
        void _w
        void _h
        return rest as PageData
      })

      const asCopy = args.as_copy !== false
      if (asCopy) {
        const name = (str(args.name) || `${original.name} (${width}x${height})`).slice(0, MAX_NAME)
        const copy = await db.design.create({
          data: {
            name,
            width,
            height,
            pages: relaid as unknown as object,
            source: `resize:${original.id}`,
            ownerId: original.ownerId ?? ownerId,
            folderId: original.folderId,
          },
          select: { id: true, name: true },
        })
        return ok({
          ok: true,
          design_id: copy.id,
          name: copy.name,
          width,
          height,
          resized_from: original.id,
          from_size: `${original.width}x${original.height}`,
          folder_id: original.folderId,
          note: 'New design; the original is unchanged. Review text sizes and positions with get_design / export_design.',
        })
      }

      await db.design.update({
        where: { id: original.id },
        data: { width, height, pages: relaid as unknown as object, updatedAt: new Date() },
      })
      // o editor aberto aplica o tamanho novo (applyRemoteOp lê width/height)
      await db.designEvent
        .create({
          data: {
            designId: original.id,
            actorId: AGENT_ACTOR,
            kind: 'pages:replace',
            payload: { kind: 'pages:replace', pages: relaid, width, height } as object,
          },
        })
        .catch(() => undefined)
      return ok({ ok: true, design_id: original.id, width, height, from_size: `${original.width}x${original.height}`, resized: 'in place' })
    },
  }

  return [resizeDesign]
}
