// ─────────────────────────────────────────────────────────────
// [VDS] Alteração local da Viagem de Sonho (patches/vds.patch).
// GET /api/vds/export/<designId>/<page>.<png|jpg>?exp=..&sig=..
// Serve a imagem de um link criado pelo export_design_url. Sem sessão:
// só a assinatura (HMAC) e a validade decidem. Qualquer falha dá 404,
// para não revelar se o design existe.
// ─────────────────────────────────────────────────────────────

import { NextRequest, NextResponse } from 'next/server'
import { db } from '@/lib/db'
import { renderDesignPage, verifyExportLink, type ExportFormat } from '@/lib/vds/export-link'

export const runtime = 'nodejs'
export const dynamic = 'force-dynamic'

const NOT_FOUND = () => NextResponse.json({ error: 'Not found.' }, { status: 404, headers: { 'Cache-Control': 'no-store' } })

export async function GET(req: NextRequest, ctx: { params: Promise<{ designId: string; file: string }> }) {
  const { designId, file } = await ctx.params
  const match = /^(\d{1,3})\.(png|jpg)$/.exec(file)
  if (!match) return NOT_FOUND()
  const page = Number(match[1])
  const format = match[2] as ExportFormat
  const exp = Number(req.nextUrl.searchParams.get('exp'))
  const sig = req.nextUrl.searchParams.get('sig') ?? ''
  if (!verifyExportLink(designId, page, format, exp, sig)) return NOT_FOUND()

  try {
    const design = await db.design.findFirst({
      where: { id: designId, deletedAt: null },
      select: { width: true, height: true, pages: true },
    })
    if (!design) return NOT_FOUND()
    const image = await renderDesignPage(design, page, format)
    if (!image) return NOT_FOUND()
    return new NextResponse(new Uint8Array(image), {
      status: 200,
      headers: {
        'Content-Type': format === 'jpg' ? 'image/jpeg' : 'image/png',
        'Content-Length': String(image.length),
        'Content-Disposition': `inline; filename="design-${designId}-${page + 1}.${format}"`,
        'Cache-Control': 'private, no-store',
        'X-Robots-Tag': 'noindex',
      },
    })
  } catch (err) {
    console.error('[vds] export link render failed', err instanceof Error ? err.message : err)
    return NextResponse.json({ error: 'Render failed.' }, { status: 500, headers: { 'Cache-Control': 'no-store' } })
  }
}
