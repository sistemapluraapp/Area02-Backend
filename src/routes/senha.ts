import type { Context } from 'hono'
import { getAnonClient } from '../lib/supabase'
import type { AppEnv } from '../types'

// "Esqueci minha senha": o Supabase gera o link de recuperação e o hook de
// e-mail da Área 04 envia com o modelo editável no ADM. O link volta para
// /redefinir-senha desta área com um acesso temporário (access_token).

const EMAIL_VALIDO = /^[^\s@]+@[^\s@]+\.[^\s@]+$/

export async function recuperarSenha(c: Context<AppEnv>) {
  const body = await c.req.json<{ email?: string }>().catch(() => null)
  const email = body?.email?.trim().toLowerCase()
  if (!email || !EMAIL_VALIDO.test(email)) return c.json({ error: 'Informe um e-mail válido' }, 400)

  const { error } = await getAnonClient(c).auth.resetPasswordForEmail(email, { redirectTo: `${c.env.FRONTEND_URL}/redefinir-senha` })
  if (error && /rate|seconds|limit/i.test(error.message)) {
    return c.json({ error: 'Aguarde um minuto antes de pedir outro link.' }, 429)
  }
  // Mesma resposta exista ou não a conta, para não revelar e-mails cadastrados
  return c.json({ message: 'Se houver uma conta com este e-mail, enviamos um link para criar uma nova senha. Confira também a caixa de spam.' })
}

export async function redefinirSenha(c: Context<AppEnv>) {
  const body = await c.req.json<{ access_token?: string; password?: string }>().catch(() => null)
  const token = body?.access_token?.trim()
  const senha = body?.password ?? ''
  if (!token) return c.json({ error: 'Link inválido. Peça um novo link de recuperação.' }, 400)
  if (senha.length < 6) return c.json({ error: 'A senha precisa ter pelo menos 6 caracteres' }, 400)
  if (senha.length > 72) return c.json({ error: 'A senha pode ter no máximo 72 caracteres' }, 400)

  const res = await fetch(`${c.env.SUPABASE_URL}/auth/v1/user`, {
    method: 'PUT',
    headers: { apikey: c.env.SUPABASE_ANON_KEY, Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' },
    body: JSON.stringify({ password: senha }),
  })
  if (!res.ok) {
    const erro = (await res.json().catch(() => ({}))) as { error_code?: string; msg?: string; message?: string }
    const texto = `${erro.error_code ?? ''} ${erro.msg ?? erro.message ?? ''}`
    if (res.status === 401 || res.status === 403 || /jwt|expired|session/i.test(texto)) {
      return c.json({ error: 'Este link expirou. Peça um novo link de recuperação.' }, 401)
    }
    if (/same_password|different from the old/i.test(texto)) return c.json({ error: 'A nova senha precisa ser diferente da anterior.' }, 400)
    if (/weak_password|password/i.test(texto)) return c.json({ error: 'Escolha uma senha mais forte.' }, 400)
    return c.json({ error: 'Não foi possível alterar a senha agora. Tente novamente.' }, 400)
  }
  return c.json({ message: 'Senha alterada. Você já pode entrar com a nova senha.' })
}
