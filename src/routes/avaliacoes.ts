import type { Context } from 'hono'
import type { AppEnv } from '../types'

export async function responderAvaliacao(c: Context<AppEnv>) {
  const supabase = c.get('supabase')
  const id = c.req.param('id')
  const body = await c.req.json<{ resposta?: string }>().catch(() => null)

  if (!body?.resposta) {
    return c.json({ error: 'Campo obrigatório: resposta' }, 400)
  }

  const { data, error } = await supabase
    .from('avaliacoes')
    .update({ resposta: body.resposta })
    .eq('id', id)
    .select('id, pagina_id, nota, comentario, resposta, respondido_em')
    .single()

  if (error) return c.json({ error: error.message }, 400)
  return c.json(data)
}
