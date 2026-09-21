import type { Context } from 'hono'
import type { AppEnv } from '../types'

export async function listarNotificacoes(c: Context<AppEnv>) {
  const supabase = c.get('supabase')
  const userId = c.get('userId')

  const status = c.req.query('status')
  const limitParam = Number(c.req.query('limit'))
  const limit = Number.isFinite(limitParam) && limitParam > 0 ? Math.min(limitParam, 100) : 30

  let query = supabase
    .from('notificacoes')
    .select('id, tipo, titulo, corpo, entidade_tipo, entidade_id, lida, lida_em, criada_em, metadata')
    .eq('destinatario_id', userId)
    .order('criada_em', { ascending: false })
    .limit(limit)

  if (status === 'nao_lidas') {
    query = query.eq('lida', false)
  }

  const { data, error } = await query

  if (error) return c.json({ error: error.message }, 500)
  return c.json({ notificacoes: data })
}

export async function contagemNaoLidas(c: Context<AppEnv>) {
  const supabase = c.get('supabase')
  const userId = c.get('userId')

  const { count, error } = await supabase
    .from('notificacoes')
    .select('id', { count: 'exact', head: true })
    .eq('destinatario_id', userId)
    .eq('lida', false)

  if (error) return c.json({ error: error.message }, 500)
  return c.json({ total: count ?? 0 })
}

export async function marcarComoLida(c: Context<AppEnv>) {
  const supabase = c.get('supabase')
  const userId = c.get('userId')
  const id = c.req.param('id')

  const { data, error } = await supabase
    .from('notificacoes')
    .update({ lida: true, lida_em: new Date().toISOString() })
    .eq('id', id)
    .eq('destinatario_id', userId)
    .select('id, lida, lida_em')
    .maybeSingle()

  if (error) return c.json({ error: error.message }, 400)
  if (!data) return c.json({ error: 'Notificação não encontrada' }, 404)
  return c.json(data)
}

export async function marcarTodasComoLidas(c: Context<AppEnv>) {
  const supabase = c.get('supabase')
  const userId = c.get('userId')

  const { data, error } = await supabase
    .from('notificacoes')
    .update({ lida: true, lida_em: new Date().toISOString() })
    .eq('destinatario_id', userId)
    .eq('lida', false)
    .select('id')

  if (error) return c.json({ error: error.message }, 400)
  return c.json({ atualizadas: data?.length ?? 0 })
}
