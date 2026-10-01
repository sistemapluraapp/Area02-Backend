import type { Context } from 'hono'
import type { AppEnv } from '../types'
import { AREA_CONFIG } from '../lib/areaConfig'

// Opções que o editor de página oferece nesta área (B2B ou B2G), com
// rótulo e ícone: categorias, tags, itens de "Antes de ir" e os grupos de
// acessibilidade com seus recursos.
// Grupos e itens em ordem alfabética (português, ignorando acentos e maiúsculas)
const porRotulo = (a: { rotulo: string }, b: { rotulo: string }) => a.rotulo.localeCompare(b.rotulo, 'pt-BR', { sensitivity: 'base' })

export async function listarOpcoes(c: Context<AppEnv>) {
  const supabase = c.get('supabase')
  const escopos = [AREA_CONFIG.escopo, 'ambos']

  const [catalogo, grupos, recursos] = await Promise.all([
    supabase.from('catalogo_itens').select('tipo, codigo, rotulo, descricao, icone, ordem').eq('ativo', true).in('escopo', escopos).order('ordem'),
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
  const porTipo = (tipo: string) => itens.filter((i) => i.tipo === tipo).map(({ tipo: _, ...resto }) => resto).sort(porRotulo)

  return c.json({
    categorias: porTipo('categoria'),
    tags: porTipo('tag'),
    antes_de_ir: porTipo('antes_de_ir'),
    grupos_acessibilidade: [...(grupos.data ?? [])].sort(porRotulo).map((g) => ({
      ...g,
      recursos: (recursos.data ?? []).filter((r) => r.categoria === g.codigo).map(({ categoria: _, ...resto }) => resto).sort(porRotulo),
    })),
  })
}

// Termos e condições editados no ADM (Comunicação → Termos e condições)
export async function obterTermo(c: Context<AppEnv>) {
  const chave = c.req.param('chave') as string
  if (!/^termos_[a-z0-9_]+$/.test(chave)) return c.json({ error: 'Termo não encontrado' }, 404)
  const { data, error } = await c.get('supabase').from('termos').select('chave, titulo, conteudo_html, atualizado_em').eq('chave', chave).maybeSingle()
  if (error) return c.json({ error: error.message }, 500)
  if (!data) return c.json({ error: 'Termo não encontrado' }, 404)
  return c.json(data)
}
