import type { Context } from 'hono'
import type { AppEnv } from '../types'

export async function solicitarCertificado(c: Context<AppEnv>) {
  const supabase = c.get('supabase')
  const paginaId = c.req.param('id')

  const { data, error } = await supabase
    .from('certificados')
    .insert({ pagina_id: paginaId })
    .select('id, status, solicitado_em')
    .single()

  if (error) return c.json({ error: error.message }, 400)
  return c.json(data, 201)
}

export async function listarCertificados(c: Context<AppEnv>) {
  const supabase = c.get('supabase')
  const paginaId = c.req.param('id')

  const { data, error } = await supabase
    .from('certificados')
    .select('id, status, solicitado_em, avaliado_em')
    .eq('pagina_id', paginaId)
    .order('solicitado_em', { ascending: false })

  if (error) return c.json({ error: error.message }, 500)
  return c.json({ certificados: data })
}
