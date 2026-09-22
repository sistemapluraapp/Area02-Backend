import type { Context } from 'hono'
import { normalizeCpf } from '../lib/cpf'
import type { AppEnv } from '../types'

export async function convidarColaborador(c: Context<AppEnv>) {
  const supabase = c.get('supabase')
  const paginaId = c.req.param('id')
  const body = await c.req.json<{ cpf?: string }>().catch(() => null)

  if (!body?.cpf) {
    return c.json({ error: 'Campo obrigatório: cpf' }, 400)
  }

  const cpf = normalizeCpf(body.cpf)
  const { data: usuarioId, error: rpcError } = await supabase.rpc('usuario_id_por_cpf', { p_cpf: cpf })

  if (rpcError) return c.json({ error: rpcError.message }, 500)
  if (!usuarioId) return c.json({ error: 'Nenhum usuário encontrado com esse CPF' }, 404)

  const { data, error } = await supabase
    .from('vinculos')
    .insert({ pagina_id: paginaId, usuario_id: usuarioId, papel: 'colaborador' })
    .select('id, usuario_id, papel, created_at, usuarios(nome)')
    .single()

  if (error) return c.json({ error: error.message }, 400)
  return c.json(data, 201)
}

export async function removerColaborador(c: Context<AppEnv>) {
  const supabase = c.get('supabase')
  const paginaId = c.req.param('id')
  const vinculoId = c.req.param('vinculoId')

  const { error } = await supabase.from('vinculos').delete().eq('id', vinculoId).eq('pagina_id', paginaId)

  if (error) return c.json({ error: error.message }, 400)
  return c.body(null, 204)
}
