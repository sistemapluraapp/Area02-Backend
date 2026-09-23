import type { Context } from 'hono'
import type { AppEnv } from '../types'
import { AREA_CONFIG } from '../lib/areaConfig'

// Opções que o editor de página oferece nesta área (B2B ou B2G), com
// rótulo e ícone: categorias, tags, itens de "Antes de ir" e os grupos de
// acessibilidade com seus recursos.
export async function listarOpcoes(c: Context<AppEnv>) {
  const supabase = c.get('supabase')
  const escopos = [AREA_CONFIG.escopo, 'ambos']

  const [catalogo, grupos, recursos] = await Promise.all([
    supabase.from('catalogo_itens').select('tipo, codigo, rotulo, icone, ordem').eq('ativo', true).in('escopo', escopos).order('ordem'),
    supabase.from('grupos_acessibilidade').select('codigo, rotulo, descricao, icone, ordem').eq('ativo', true).order('ordem'),
    supabase
      .from('filtros_acessibilidade')
      .select('categoria, codigo, rotulo, icone, descricao, ordem')
      .eq('tipo', 'recurso_local')
      .eq('ativo', true)
      .in('escopo', escopos)
      .order('ordem'),
  ])

  const erro = catalogo.error ?? grupos.error ?? recursos.error
  if (erro) return c.json({ error: erro.message }, 500)

  const itens = catalogo.data ?? []
  const porTipo = (tipo: string) => itens.filter((i) => i.tipo === tipo).map(({ tipo: _, ...resto }) => resto)

  return c.json({
    categorias: porTipo('categoria'),
    tags: porTipo('tag'),
    antes_de_ir: porTipo('antes_de_ir'),
    grupos_acessibilidade: (grupos.data ?? []).map((g) => ({
      ...g,
      recursos: (recursos.data ?? []).filter((r) => r.categoria === g.codigo).map(({ categoria: _, ...resto }) => resto),
    })),
  })
}
