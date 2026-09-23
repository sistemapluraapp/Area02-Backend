import type { SupabaseClient } from '@supabase/supabase-js'
import { AREA_CONFIG } from './areaConfig'

// Opções válidas para esta área (itens ativos com escopo desta área ou 'ambos').
export interface OpcoesArea {
  categorias: string[]
  tags: string[]
  antesDeIr: string[]
  recursos: string[]
}

export async function carregarOpcoesValidas(supabase: SupabaseClient): Promise<OpcoesArea> {
  const escopos = [AREA_CONFIG.escopo, 'ambos']
  const [{ data: catalogo }, { data: recursos }] = await Promise.all([
    supabase.from('catalogo_itens').select('tipo, codigo').eq('ativo', true).in('escopo', escopos),
    supabase.from('filtros_acessibilidade').select('codigo').eq('tipo', 'recurso_local').eq('ativo', true).in('escopo', escopos),
  ])
  const porTipo = (tipo: string) => (catalogo ?? []).filter((i) => i.tipo === tipo).map((i) => i.codigo as string)
  return {
    categorias: porTipo('categoria'),
    tags: porTipo('tag'),
    antesDeIr: porTipo('antes_de_ir'),
    recursos: (recursos ?? []).map((r) => r.codigo as string),
  }
}

export function codigosInvalidos(valores: string[], validos: string[]): string[] {
  return valores.filter((v) => !validos.includes(v))
}
