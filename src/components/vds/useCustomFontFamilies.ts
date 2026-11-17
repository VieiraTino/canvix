// ─────────────────────────────────────────────────────────────
// [VDS] Alteração local da Viagem de Sonho (patches/vds.patch).
// Nomes das fontes carregadas pelo utilizador, para o Brand kit as
// mostrar ao lado das do catálogo. Regista-as no browser (FontFace),
// para a pré-visualização sair com a letra certa.
// ─────────────────────────────────────────────────────────────

'use client'

import { useEffect, useState } from 'react'
import { loadCustomFonts } from '@/lib/fonts/loader'

export function useCustomFontFamilies(): string[] {
  const [families, setFamilies] = useState<string[]>([])
  useEffect(() => {
    let alive = true
    void loadCustomFonts().then((fonts) => {
      if (!alive) return
      const unique = Array.from(new Set(fonts.map((f) => f.family))).sort((a, b) => a.localeCompare(b))
      setFamilies(unique)
    })
    return () => {
      alive = false
    }
  }, [])
  return families
}
