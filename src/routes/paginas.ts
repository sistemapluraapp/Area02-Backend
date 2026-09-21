import type { Context } from 'hono'
import type { AppEnv } from '../types'

interface NovaPaginaBody {
  nome?: string
  descricao?: string
}

export async function criarPagina(c: Context<AppEnv>) {
  const supabase = c.get('supabase')
  const userId = c.get('userId')
  const body = await c.req.json<NovaPaginaBody>().catch(() => null)

  if (!body?.nome) {
    return c.json({ error: 'Campo obrigatório: nome' }, 400)
  }

  const { data, error } = await supabase
    .from('paginas')
    .insert({ tipo: 'privada', nome: body.nome, descricao: body.descricao ?? null, criado_por_usuario: userId })
    .select('id, tipo, nome, descricao, created_at')
    .single()

  if (error) return c.json({ error: error.message }, 400)
  return c.json(data, 201)
}

export async function minhasPaginas(c: Context<AppEnv>) {
  const supabase = c.get('supabase')
  const userId = c.get('userId')

  const { data, error } = await supabase
    .from('vinculos')
    .select('papel, paginas(id, tipo, nome, descricao, created_at)')
    .eq('usuario_id', userId)

  if (error) return c.json({ error: error.message }, 500)
  return c.json({ paginas: data })
}

export async function obterPagina(c: Context<AppEnv>) {
  const supabase = c.get('supabase')
  const id = c.req.param('id')

  const { data: pagina, error } = await supabase
    .from('paginas')
    .select('id, tipo, nome, descricao, created_at')
    .eq('id', id)
    .single()

  if (error) return c.json({ error: 'Página não encontrada ou sem acesso' }, 404)

  const [{ data: vinculos }, { data: avaliacoes }, { data: certificados }] = await Promise.all([
    supabase.from('vinculos').select('id, usuario_id, papel, created_at').eq('pagina_id', id),
    supabase
      .from('avaliacoes')
      .select('id, usuario_id, nota, comentario, resposta, respondido_em, sinalizada, created_at')
      .eq('pagina_id', id)
      .order('created_at', { ascending: false }),
    supabase.from('certificados').select('id, status, solicitado_em, avaliado_em').eq('pagina_id', id),
  ])

  return c.json({ ...pagina, vinculos: vinculos ?? [], avaliacoes: avaliacoes ?? [], certificados: certificados ?? [] })
}

export async function atualizarPagina(c: Context<AppEnv>) {
  const supabase = c.get('supabase')
  const id = c.req.param('id')
  const body = await c.req.json<NovaPaginaBody>().catch(() => null)

  const patch: Record<string, string> = {}
  if (body?.nome) patch.nome = body.nome
  if (body?.descricao !== undefined) patch.descricao = body.descricao ?? ''

  const { data, error } = await supabase
    .from('paginas')
    .update(patch)
    .eq('id', id)
    .select('id, tipo, nome, descricao, created_at')
    .single()

  if (error) return c.json({ error: error.message }, 400)
  return c.json(data)
}
