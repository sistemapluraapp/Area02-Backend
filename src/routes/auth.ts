import type { Context } from 'hono'
import { getAnonClient } from '../lib/supabase'
import type { AppEnv } from '../types'

export async function login(c: Context<AppEnv>) {
  const body = await c.req.json<{ email?: string; password?: string }>().catch(() => null)
  if (!body?.email || !body.password) {
    return c.json({ error: 'Campos obrigatórios: email, password' }, 400)
  }

  const anon = getAnonClient(c)
  const { data, error } = await anon.auth.signInWithPassword({
    email: body.email,
    password: body.password,
  })

  if (error || !data.session) {
    return c.json({ error: 'E-mail ou senha inválidos' }, 401)
  }

  return c.json({
    user: { id: data.user.id, email: data.user.email },
    access_token: data.session.access_token,
    refresh_token: data.session.refresh_token,
  })
}
