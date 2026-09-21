import type { Context } from 'hono'
import { getAnonClient } from '../lib/supabase'
import { isValidCpf, normalizeCpf } from '../lib/cpf'
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

export async function refresh(c: Context<AppEnv>) {
  const body = await c.req.json<{ refresh_token?: string }>().catch(() => null)
  if (!body?.refresh_token) {
    return c.json({ error: 'Campo obrigatório: refresh_token' }, 400)
  }

  const anon = getAnonClient(c)
  const { data, error } = await anon.auth.refreshSession({ refresh_token: body.refresh_token })

  if (error || !data.session) {
    return c.json({ error: 'Sessão inválida ou expirada, faça login novamente' }, 401)
  }

  return c.json({
    user: { id: data.user!.id, email: data.user!.email },
    access_token: data.session.access_token,
    refresh_token: data.session.refresh_token,
  })
}

interface SignupBody {
  email?: string
  password?: string
  cpf?: string
  nome?: string
}

export async function signup(c: Context<AppEnv>) {
  const body = await c.req.json<SignupBody>().catch(() => null)
  if (!body?.email || !body.password || !body.cpf || !body.nome) {
    return c.json({ error: 'Campos obrigatórios: email, password, cpf, nome' }, 400)
  }

  const cpf = normalizeCpf(body.cpf)
  if (!isValidCpf(cpf)) {
    return c.json({ error: 'CPF inválido' }, 400)
  }

  const anon = getAnonClient(c)

  const { data: cpfEmUso, error: cpfError } = await anon.rpc('cpf_em_uso', { p_cpf: cpf })
  if (cpfError) {
    return c.json({ error: `Não foi possível validar o CPF: ${cpfError.message}` }, 500)
  }
  if (cpfEmUso) {
    return c.json({ error: 'Este CPF já está cadastrado' }, 409)
  }

  const { data: signUpData, error: signUpError } = await anon.auth.signUp({
    email: body.email,
    password: body.password,
    options: { data: { tipo: 'usuario', nome: body.nome, cpf } },
  })

  if (signUpError || !signUpData.user) {
    return c.json({ error: signUpError?.message ?? 'Não foi possível criar a conta' }, 400)
  }

  if (!signUpData.session) {
    return c.json(
      {
        message: 'Conta criada. Confirme seu e-mail para poder fazer login.',
        user_id: signUpData.user.id,
        pending_email_confirmation: true,
      },
      201,
    )
  }

  return c.json(
    {
      user: { id: signUpData.user.id, email: body.email, nome: body.nome },
      access_token: signUpData.session.access_token,
      refresh_token: signUpData.session.refresh_token,
    },
    201,
  )
}
