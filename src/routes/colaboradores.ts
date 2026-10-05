import type { Context } from 'hono'
import type { AppEnv } from '../types'
import { ABAS, ROTULO_ABA, abasPermitidas, type Aba } from '../lib/acesso'
import { AREA_CONFIG } from '../lib/areaConfig'
import { enviarEmail } from '../lib/email'
import { escaparHtml, montarAviso } from '../lib/emailLayout'

// Equipe da página (compartilhado Áreas 02/03). As rotas passam antes pelo
// middleware exigirAcessoPagina, que exige a aba "equipe".

const EMAIL_VALIDO = /^[^\s@]+@[^\s@]+\.[^\s@]+$/
const DIAS_CONVITE = 14

function validarPermissoes(valor: unknown): Aba[] | null {
  if (valor === undefined) return []
  if (!Array.isArray(valor) || valor.some((v) => !ABAS.includes(v as Aba))) return null
  return [...new Set(valor as Aba[])]
}

function validarCargo(valor: unknown): string | null | undefined {
  if (valor === undefined) return undefined
  if (valor === null) return null
  if (typeof valor !== 'string') return undefined
  return valor.trim().slice(0, 80) || null
}

async function membro(c: Context<AppEnv>, paginaId: string, vinculoId: string) {
  const { data } = await c.get('supabase').rpc('equipe_da_pagina', { p_pagina_id: paginaId })
  return ((data ?? []) as { id: string }[]).find((m) => m.id === vinculoId) ?? null
}

export async function listarEquipe(c: Context<AppEnv>) {
  const paginaId = c.req.param('id') as string
  const { data, error } = await c.get('supabase').rpc('equipe_da_pagina', { p_pagina_id: paginaId })
  if (error) return c.json({ error: error.message }, 500)
  return c.json({ equipe: data ?? [], abas: ABAS.map((id) => ({ id, rotulo: ROTULO_ABA[id] })) })
}

export async function convidarColaborador(c: Context<AppEnv>) {
  const supabase = c.get('supabase')
  const paginaId = c.req.param('id') as string
  const body = await c.req.json<{ email?: string; cargo?: unknown; permissoes?: unknown }>().catch(() => null)

  const email = body?.email?.trim().toLowerCase() ?? ''
  if (!EMAIL_VALIDO.test(email)) return c.json({ error: 'Informe um e-mail válido' }, 400)
  const permissoes = validarPermissoes(body?.permissoes)
  if (!permissoes) return c.json({ error: 'Permissões inválidas' }, 400)
  const cargo = validarCargo(body?.cargo) ?? null

  const { data: conta, error: rpcError } = await supabase.rpc('conta_por_email', { p_email: email }).maybeSingle<{ id: string; tipo: 'usuario' | 'gov' }>()
  if (rpcError) return c.json({ error: rpcError.message }, 500)
  if (!conta) {
    return c.json(
      {
        error: 'Não encontramos uma conta Plura com este e-mail. Peça para a pessoa criar uma conta gratuita em plura.app.br e tente de novo.',
        codigo: 'sem_conta',
      },
      404,
    )
  }
  if (conta.tipo === 'gov' && !AREA_CONFIG.aceitaContaGov) {
    return c.json({ error: 'Este e-mail é de uma conta institucional Gov. Contas Gov só colaboram em páginas da Plura Gov.', codigo: 'conta_gov' }, 400)
  }

  const coluna = conta.tipo === 'gov' ? 'gov_conta_id' : 'usuario_id'
  const { data: vinculo, error } = await supabase
    .from('vinculos')
    .insert({
      pagina_id: paginaId,
      [coluna]: conta.id,
      papel: 'colaborador',
      cargo,
      permissoes,
      // Só vira membro depois de aceitar (public.responder_convite_equipe)
      status: 'pendente',
      convidado_por: c.get('userId'),
      convidado_em: new Date().toISOString(),
      expira_em: new Date(Date.now() + DIAS_CONVITE * 86_400_000).toISOString(),
    })
    .select('id')
    .single()

  if (error) {
    if (error.code === '23505') return c.json({ error: 'Esta pessoa já faz parte da equipe ou já tem um convite pendente' }, 409)
    return c.json({ error: error.message }, 400)
  }

  await avisarConvidado(c, paginaId, vinculo.id, email, cargo, permissoes)
  const novo = await membro(c, paginaId, vinculo.id)
  c.set('acaoLog', `Convidou ${email} para a equipe`)
  return c.json(novo ?? { id: vinculo.id }, 201)
}

// Notificação no sino + e-mail para a pessoa aceitar ou recusar
async function avisarConvidado(c: Context<AppEnv>, paginaId: string, vinculoId: string, email: string, cargo: string | null, permissoes: string[]) {
  const supabase = c.get('supabase')
  try {
    await supabase.rpc('notificar_convite_equipe', { p_vinculo_id: vinculoId })
  } catch (err) {
    console.error('Falha ao notificar convite:', err)
  }
  const { data: pagina } = await supabase.from('paginas').select('nome').eq('id', paginaId).maybeSingle()
  if (!pagina || !c.env.RESEND_API_KEY) return
  const nome = escaparHtml(pagina.nome)
  const lista = permissoes.length
    ? permissoes.map((aba) => escaparHtml(ROTULO_ABA[aba as Aba] ?? aba)).join(', ')
    : 'o responsável pela página vai liberar as abas depois'
  await enviarEmail(
    c.env.RESEND_API_KEY,
    email,
    `Convite para a equipe de ${pagina.nome}`,
    montarAviso(
      'Você recebeu um convite para uma equipe na Plura',
      `<p>Você foi convidado(a) para a equipe da página <strong>${nome}</strong>${cargo ? `, como <strong>${escaparHtml(cargo)}</strong>` : ''}.</p>
       <p>Abas que você poderá editar: ${lista}.</p>
       <p>Para aceitar ou recusar, entre com o seu e-mail e senha da Plura e abra <strong>Minhas páginas</strong>. O convite vale por ${DIAS_CONVITE} dias.</p>`,
      { texto: 'Ver convite', link: c.env.FRONTEND_URL },
    ),
    c.env.EMAIL_REMETENTE,
  )
}

// Reenvia um convite pendente ou expirado (renova o prazo)
export async function reenviarConvite(c: Context<AppEnv>) {
  const supabase = c.get('supabase')
  const paginaId = c.req.param('id') as string
  const vinculoId = c.req.param('vinculoId') as string
  const alvo = (await membro(c, paginaId, vinculoId)) as { status?: string; email?: string; nome?: string; cargo?: string | null; permissoes?: string[] } | null
  if (!alvo) return c.json({ error: 'Convite não encontrado' }, 404)
  if (alvo.status !== 'pendente') return c.json({ error: 'Esta pessoa já aceitou o convite' }, 400)

  const { error } = await supabase
    .from('vinculos')
    .update({ convidado_em: new Date().toISOString(), expira_em: new Date(Date.now() + DIAS_CONVITE * 86_400_000).toISOString() })
    .eq('id', vinculoId)
    .eq('pagina_id', paginaId)
  if (error) return c.json({ error: error.message }, 400)

  if (alvo.email) await avisarConvidado(c, paginaId, vinculoId, alvo.email, alvo.cargo ?? null, alvo.permissoes ?? [])
  c.set('acaoLog', `Reenviou o convite de ${alvo.email ?? alvo.nome ?? 'um membro'}`)
  return c.json(await membro(c, paginaId, vinculoId))
}

// ---------- Convites recebidos (quem foi convidado) ----------

export async function meusConvites(c: Context<AppEnv>) {
  const { data, error } = await c.get('supabase').rpc('meus_convites_equipe')
  if (error) return c.json({ error: error.message }, 500)
  const daArea = ((data ?? []) as { pagina_tipo: string }[]).filter((cv) => cv.pagina_tipo === AREA_CONFIG.tipoPagina)
  return c.json({ convites: daArea })
}

export async function responderConvite(c: Context<AppEnv>) {
  const vinculoId = c.req.param('id') as string
  const aceitar = c.req.path.endsWith('/aceitar')
  const { data, error } = await c
    .get('supabase')
    .rpc('responder_convite_equipe', { p_vinculo_id: vinculoId, p_aceitar: aceitar })
    .maybeSingle<{ pagina_id: string; pagina_nome: string; pagina_tipo: string }>()
  if (error) return c.json({ error: error.message }, 400)
  return c.json({ aceito: aceitar, ...data })
}

export async function atualizarColaborador(c: Context<AppEnv>) {
  const supabase = c.get('supabase')
  const paginaId = c.req.param('id') as string
  const vinculoId = c.req.param('vinculoId') as string
  const body = await c.req.json<{ cargo?: unknown; permissoes?: unknown }>().catch(() => null)
  if (!body) return c.json({ error: 'Corpo da requisição inválido' }, 400)

  const patch: Record<string, unknown> = {}
  if (body.permissoes !== undefined) {
    const permissoes = validarPermissoes(body.permissoes)
    if (!permissoes) return c.json({ error: 'Permissões inválidas' }, 400)
    patch.permissoes = permissoes
  }
  if (body.cargo !== undefined) patch.cargo = validarCargo(body.cargo) ?? null
  if (Object.keys(patch).length === 0) return c.json({ error: 'Nada para atualizar' }, 400)

  const antes = (await membro(c, paginaId, vinculoId)) as { nome?: string; eh_voce?: boolean; papel?: string } | null
  if (!antes) return c.json({ error: 'Membro da equipe não encontrado' }, 404)
  if (antes.eh_voce && c.get('acesso').papel !== 'administrador') {
    return c.json({ error: 'Você não pode alterar as próprias permissões' }, 403)
  }

  const { error } = await supabase.from('vinculos').update(patch).eq('id', vinculoId).eq('pagina_id', paginaId)
  if (error) return c.json({ error: error.message.replace(/^.*?: /, '') }, 400)

  const partes: string[] = []
  if (patch.cargo !== undefined) partes.push(`cargo para "${patch.cargo ?? 'sem cargo'}"`)
  if (patch.permissoes !== undefined) partes.push('permissões')
  c.set('acaoLog', `Alterou ${partes.join(' e ')} de ${antes.nome ?? 'um membro'}`)
  return c.json(await membro(c, paginaId, vinculoId))
}

export async function removerColaborador(c: Context<AppEnv>) {
  const supabase = c.get('supabase')
  const paginaId = c.req.param('id') as string
  const vinculoId = c.req.param('vinculoId') as string

  const alvo = (await membro(c, paginaId, vinculoId)) as { nome?: string; papel?: string; status?: string; email?: string } | null
  if (!alvo) return c.json({ error: 'Membro da equipe não encontrado' }, 404)
  if (alvo.papel === 'administrador') return c.json({ error: 'O administrador da página não pode ser removido' }, 400)

  const { error } = await supabase.from('vinculos').delete().eq('id', vinculoId).eq('pagina_id', paginaId)
  if (error) return c.json({ error: error.message }, 400)

  c.set('acaoLog', alvo.status === 'pendente' ? `Cancelou o convite de ${alvo.email ?? alvo.nome ?? 'um membro'}` : `Removeu ${alvo.nome ?? 'um membro'} da equipe`)
  return c.body(null, 204)
}

export async function listarLogs(c: Context<AppEnv>) {
  const paginaId = c.req.param('id') as string
  const limite = Math.min(Math.max(Number(c.req.query('limite')) || 100, 1), 500)
  const { data, error } = await c
    .get('supabase')
    .from('pagina_logs')
    .select('id, autor_id, autor_nome, acao, criado_em')
    .eq('pagina_id', paginaId)
    .order('criado_em', { ascending: false })
    .limit(limite)
  if (error) return c.json({ error: error.message }, 500)
  return c.json({ logs: data ?? [] })
}

// Usado em GET /paginas/:id para o editor mostrar só as abas liberadas
export function meuAcesso(c: Context<AppEnv>) {
  const acesso = c.get('acesso')
  return { papel: acesso.papel, cargo: acesso.cargo, abas: abasPermitidas(acesso) }
}
