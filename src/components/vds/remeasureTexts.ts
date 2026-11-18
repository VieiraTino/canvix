// ─────────────────────────────────────────────────────────────
// [VDS] Alteração local da Viagem de Sonho.
// Quando uma fonte acaba de carregar, o Konva já mediu os textos com a
// fonte de recurso (larguras, quebras de linha, alinhamento). Só
// redesenhar (batchDraw) pinta a fonte certa nas posições antigas, e o
// texto aparece deslocado até se mexer nele; a pré-visualização, que
// cria nós novos, mostra-o no sítio certo. Aqui forçamos a nova medição
// de todos os Text/TextPath e só depois redesenhamos.
// ─────────────────────────────────────────────────────────────

import type Konva from 'konva'

type Remeasurable = Konva.Node & { _setTextData?: () => void }

export function remeasureTexts(stage: Konva.Stage | null | undefined): void {
  if (!stage) return
  const nodes = [...stage.find('Text'), ...stage.find('TextPath')] as Remeasurable[]
  for (const node of nodes) {
    // _setTextData é o passo interno do Konva que recalcula as linhas e larguras
    node._setTextData?.()
    if (node.isCached()) {
      node.clearCache()
      node.cache()
    }
  }
  stage.batchDraw()
}
