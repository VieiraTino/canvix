// ─────────────────────────────────────────────────────────────
// [VDS] Alteração local da Viagem de Sonho.
// Ferramenta MCP get_usage_rules: as regras de uso do Canvix escritas na
// app interna (remote-instructions.ts). Existe porque nem todos os
// clientes MCP leem as instructions do initialize; as descrições das
// ferramentas leem sempre.
// ─────────────────────────────────────────────────────────────

import { textResult, type ToolDef } from '@/lib/mcp/tools'
import { formatVdsRules, getVdsRules } from './remote-instructions'

export function buildVdsRulesTools(): ToolDef[] {
  const getUsageRules: ToolDef = {
    name: 'get_usage_rules',
    description:
      'Viagem de Sonho rules for using this Canvix (where you may write, how to use templates, the Brand Kit, validation). Call this FIRST, before any other Canvix tool, and follow it for the whole task.',
    inputSchema: { type: 'object', properties: {} },
    handler: async () => {
      const rules = await getVdsRules()
      if (!rules) {
        return textResult('No Viagem de Sonho rules are configured on this server right now. Work only on copies of designs and never change originals.')
      }
      return textResult(formatVdsRules(rules))
    },
  }
  return [getUsageRules]
}
