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
    .select('id, status, created_at, enviada_em, decidida_em, concedida_em, expira_em, observacao_adm, codigo, certificacao:certificacoes(id, titulo, resumo, icone, imagem_url, validade_meses)')
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
    .select('id, certificacao_id, pagina_id, status, created_at, enviada_em, decidida_em, concedida_em, expira_em, observacao_adm, codigo')
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

// ---- Etapa 8c: arquivos no R2 (bucket CERTIFICACOES) ----

const MAX_BYTES = 25 * 1024 * 1024
// Tipos aceitos: documentos, planilhas, imagens e vídeos curtos
const TIPOS_ACEITOS: Record<string, string> = {
  pdf: 'application/pdf',
  jpg: 'image/jpeg', jpeg: 'image/jpeg', png: 'image/png', webp: 'image/webp', heic: 'image/heic',
  doc: 'application/msword', docx: 'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
  xls: 'application/vnd.ms-excel', xlsx: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
  odt: 'application/vnd.oasis.opendocument.text', ods: 'application/vnd.oasis.opendocument.spreadsheet',
  txt: 'text/plain', csv: 'text/csv', mp4: 'video/mp4', mov: 'video/quicktime',
}

function nomeSeguro(nome: string) {
  const limpo = nome.normalize('NFD').replace(/[̀-ͯ]/g, '').replace(/[^\w.\- ]+/g, '').replace(/\s+/g, '-').slice(-120)
  return limpo || 'arquivo'
}

// POST /paginas/:id/inscricoes/:inscricaoId/respostas/:requisitoId/arquivos (multipart, campo "arquivo")
export async function enviarArquivo(c: Context<AppEnv>) {
  const inscricaoId = c.req.param('inscricaoId') as string
  const requisitoId = c.req.param('requisitoId') as string
  const corpo = await c.req.parseBody().catch(() => null)
  const arquivo = corpo?.arquivo
  if (!(arquivo instanceof File)) return c.json({ error: 'Envie um arquivo' }, 400)
  if (arquivo.size <= 0) return c.json({ error: 'O arquivo está vazio' }, 400)
  if (arquivo.size > MAX_BYTES) return c.json({ error: 'O arquivo passa de 25 MB' }, 413)
  const extensao = (arquivo.name.split('.').pop() ?? '').toLowerCase()
  const tipo = TIPOS_ACEITOS[extensao]
  if (!tipo) return c.json({ error: 'Formato não aceito. Use PDF, imagem, documento, planilha ou vídeo MP4/MOV.' }, 400)

  // Confere antes de gravar (a função do banco confere de novo ao registrar)
  const { data: insc } = await c.get('supabase').from('certificacao_inscricoes').select('id, status').eq('id', inscricaoId).eq('pagina_id', c.req.param('id') as string).maybeSingle()
  if (!insc) return c.json({ error: 'Inscrição não encontrada' }, 404)
  if (insc.status !== 'em_andamento') return c.json({ error: 'Esta inscrição não pode ser alterada agora' }, 400)

  const chave = `inscricoes/${inscricaoId}/${requisitoId}/${crypto.randomUUID()}-${nomeSeguro(arquivo.name)}`
  await c.env.CERTIFICACOES.put(chave, arquivo.stream(), {
    httpMetadata: { contentType: tipo },
    customMetadata: { nome: encodeURIComponent(arquivo.name.slice(0, 200)), enviado_por: c.get('userId') ?? '' },
  })
  const { data, error } = await c.get('supabase').rpc('adicionar_arquivo_certificacao', {
    p_inscricao_id: inscricaoId,
    p_requisito_id: requisitoId,
    p_item: { chave, nome: arquivo.name.slice(0, 200), tamanho: arquivo.size, tipo },
  })
  if (error) {
    await c.env.CERTIFICACOES.delete(chave).catch(() => {})
    return erroRpc(c, error)
  }
  c.set('acaoLog', `Enviou um arquivo para a certificação (${arquivo.name.slice(0, 80)})`)
  return c.json(data, 201)
}

// DELETE /paginas/:id/inscricoes/:inscricaoId/respostas/:requisitoId/arquivos?chave=...
export async function removerArquivo(c: Context<AppEnv>) {
  const chave = c.req.query('chave') ?? ''
  const { data, error } = await c.get('supabase').rpc('remover_arquivo_certificacao', {
    p_inscricao_id: c.req.param('inscricaoId') as string,
    p_requisito_id: c.req.param('requisitoId') as string,
    p_chave: chave,
  })
  if (error) return erroRpc(c, error)
  if (!data) return c.json({ error: 'Arquivo não encontrado' }, 404)
  await c.env.CERTIFICACOES.delete(chave).catch(() => {})
  c.set('acaoLog', 'Removeu um arquivo da certificação')
  return c.json({ ok: true })
}

// GET /paginas/:id/inscricoes/:inscricaoId/respostas/:requisitoId/arquivos?chave=...
// Só baixa arquivos que a equipe da página enxerga (RLS) e que estão na resposta.
export async function baixarArquivo(c: Context<AppEnv>) {
  const inscricaoId = c.req.param('inscricaoId') as string
  const requisitoId = c.req.param('requisitoId') as string
  const chave = c.req.query('chave') ?? ''
  const { data: resp } = await c
    .get('supabase')
    .from('certificacao_respostas')
    .select('valor, inscricao:certificacao_inscricoes!inner(pagina_id)')
    .eq('inscricao_id', inscricaoId)
    .eq('requisito_id', requisitoId)
    .eq('inscricao.pagina_id', c.req.param('id') as string)
    .maybeSingle()
  const itens = ((resp?.valor as { itens?: { chave: string; nome: string }[] } | undefined)?.itens ?? [])
  const item = itens.find((i) => i.chave === chave)
  if (!item) return c.json({ error: 'Arquivo não encontrado' }, 404)
  const objeto = await c.env.CERTIFICACOES.get(chave)
  if (!objeto) return c.json({ error: 'Arquivo não encontrado no armazenamento' }, 404)
  return new Response(objeto.body, {
    headers: {
      'Content-Type': objeto.httpMetadata?.contentType ?? 'application/octet-stream',
      'Content-Length': String(objeto.size),
      'Content-Disposition': `attachment; filename*=UTF-8''${encodeURIComponent(item.nome)}`,
      'Cache-Control': 'private, no-store',
      'X-Content-Type-Options': 'nosniff',
    },
  })
}
