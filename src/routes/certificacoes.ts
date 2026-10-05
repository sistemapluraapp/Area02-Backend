import type { Context } from 'hono'
import type { AppEnv } from '../types'
import { AREA_CONFIG } from '../lib/areaConfig'

// Etapa 8b: buscar certificações publicadas pelo ADM e inscrever a página.
// As escritas passam por funções do banco (security definer) que conferem a
// permissão da aba "selos"; o middleware exigirAcessoPagina já barra antes.
// Arquivo idêntico nas Áreas 02 e 03 (a diferença vem de AREA_CONFIG).

const COLUNAS_CERT = 'id, titulo, resumo, descricao, imagem_url, icone, escopo, pais, uf, cidade, validade_meses, gratuita, preco_centavos, ordem'

function statusErro(code?: string) {
  if (code === '42501') return 403
  if (code === 'P0002') return 404
  return 400
}

function erroRpc(c: Context<AppEnv>, error: { message: string; code?: string }) {
  return c.json({ error: error.message }, statusErro(error.code))
}

async function estrutura(c: Context<AppEnv>, certificacaoId: string) {
  const { data, error } = await c
    .get('supabase')
    .from('certificacoes')
    .select(`${COLUNAS_CERT}, etapas:certificacao_etapas(id, titulo, descricao, modo, ordem, requisitos:certificacao_requisitos(id, titulo, descricao, tipo, obrigatorio, config, ordem))`)
    .eq('id', certificacaoId)
    .maybeSingle()
  if (error || !data) return null
  type Etapa = { ordem: number; requisitos: { ordem: number }[] }
  const etapas = ((data.etapas ?? []) as Etapa[]).sort((a, b) => a.ordem - b.ordem)
  for (const e of etapas) e.requisitos.sort((a, b) => a.ordem - b.ordem)
  return { ...data, etapas }
}

// GET /certificacoes: conteúdo da página "Buscar certificações" + lista desta área
export async function listarCertificacoesPublicadas(c: Context<AppEnv>) {
  const supabase = c.get('supabase')
  const [{ data: pagina }, { data, error }] = await Promise.all([
    supabase.from('certificacoes_pagina').select('titulo, subtitulo, blocos').eq('id', 1).maybeSingle(),
    supabase
      .from('certificacoes')
      .select(`${COLUNAS_CERT}, etapas:certificacao_etapas(id, requisitos:certificacao_requisitos(id))`)
      .in('escopo', [AREA_CONFIG.escopo, 'ambos'])
      .order('ordem')
      .order('titulo'),
  ])
  if (error) return c.json({ error: error.message }, 500)
  const certificacoes = (data ?? []).map(({ etapas, ...cert }) => {
    const lista = (etapas ?? []) as { requisitos: unknown[] }[]
    return { ...cert, total_etapas: lista.length, total_requisitos: lista.reduce((t, e) => t + (e.requisitos?.length ?? 0), 0) }
  })
  return c.json({ pagina: pagina ?? { titulo: 'Certificações', subtitulo: null, blocos: [] }, certificacoes })
}

// GET /certificacoes/:id: detalhes com etapas e requisitos
export async function obterCertificacaoPublicada(c: Context<AppEnv>) {
  const cert = await estrutura(c, c.req.param('id') as string)
  if (!cert || ![AREA_CONFIG.escopo, 'ambos'].includes(cert.escopo)) return c.json({ error: 'Certificação não encontrada' }, 404)
  return c.json(cert)
}

// GET /paginas/:id/inscricoes
export async function listarInscricoes(c: Context<AppEnv>) {
  const { data, error } = await c
    .get('supabase')
    .from('certificacao_inscricoes')
    .select('id, status, created_at, enviada_em, decidida_em, concedida_em, expira_em, observacao_adm, certificacao:certificacoes(id, titulo, resumo, icone, imagem_url, validade_meses)')
    .eq('pagina_id', c.req.param('id') as string)
    .order('created_at', { ascending: false })
  if (error) return c.json({ error: error.message }, 500)
  return c.json({ inscricoes: data ?? [] })
}

// POST /paginas/:id/inscricoes { certificacao_id }
export async function inscreverPagina(c: Context<AppEnv>) {
  const body = await c.req.json<{ certificacao_id?: unknown }>().catch(() => null)
  if (typeof body?.certificacao_id !== 'string') return c.json({ error: 'Informe a certificação' }, 400)
  const { data, error } = await c
    .get('supabase')
    .rpc('inscrever_certificacao', { p_certificacao_id: body.certificacao_id, p_pagina_id: c.req.param('id') as string })
  if (error) return erroRpc(c, error)
  return c.json(data, 201)
}

// GET /paginas/:id/inscricoes/:inscricaoId: inscrição + estrutura + respostas + etapas liberadas
export async function obterInscricao(c: Context<AppEnv>) {
  const supabase = c.get('supabase')
  const inscricaoId = c.req.param('inscricaoId') as string
  const { data: insc } = await supabase
    .from('certificacao_inscricoes')
    .select('id, certificacao_id, pagina_id, status, created_at, enviada_em, decidida_em, concedida_em, expira_em, observacao_adm')
    .eq('id', inscricaoId)
    .eq('pagina_id', c.req.param('id') as string)
    .maybeSingle()
  if (!insc) return c.json({ error: 'Inscrição não encontrada' }, 404)
  const [cert, { data: respostas }, { data: liberadas }] = await Promise.all([
    estrutura(c, insc.certificacao_id),
    supabase.from('certificacao_respostas').select('requisito_id, valor, status, comentario_adm, updated_at').eq('inscricao_id', inscricaoId),
    supabase.rpc('etapas_liberadas_inscricao', { p_inscricao_id: inscricaoId }),
  ])
  if (!cert) return c.json({ error: 'Certificação não encontrada' }, 404)
  return c.json({ ...insc, certificacao: cert, respostas: respostas ?? [], etapas_liberadas: liberadas ?? [] })
}

// PUT /paginas/:id/inscricoes/:inscricaoId/respostas/:requisitoId { valor }
export async function salvarResposta(c: Context<AppEnv>) {
  const body = await c.req.json<{ valor?: unknown }>().catch(() => null)
  if (!body || typeof body.valor !== 'object' || body.valor === null || Array.isArray(body.valor)) {
    return c.json({ error: 'Resposta inválida' }, 400)
  }
  const { data, error } = await c.get('supabase').rpc('salvar_resposta_certificacao', {
    p_inscricao_id: c.req.param('inscricaoId') as string,
    p_requisito_id: c.req.param('requisitoId') as string,
    p_valor: body.valor,
  })
  if (error) return erroRpc(c, error)
  return c.json(data)
}

// POST /paginas/:id/inscricoes/:inscricaoId/enviar | /cancelar
export async function acaoInscricao(c: Context<AppEnv>) {
  const funcao = c.req.path.endsWith('/enviar') ? 'enviar_inscricao_certificacao' : 'cancelar_inscricao_certificacao'
  const { data, error } = await c.get('supabase').rpc(funcao, { p_inscricao_id: c.req.param('inscricaoId') as string })
  if (error) return erroRpc(c, error)
  return c.json(data)
}
