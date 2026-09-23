import type { Context } from 'hono'
import type { AppEnv } from '../types'
import { uploadFotoPagina } from '../lib/fotos'
import { carregarOpcoesValidas, codigosInvalidos } from '../lib/catalogo'

// Experiências turísticas do empreendimento (cards na página pública).

const NIVEIS = ['todos', 'facil', 'moderado', 'dificil']
const TEXTOS: Record<string, number> = {
  nome: 120,
  descricao: 3000,
  duracao: 60,
  local: 200,
  faixa_etaria: 80,
  equipamentos: 1000,
  o_que_levar: 1000,
}

type ExperienciaBody = Record<string, unknown>

async function montarPatch(c: Context<AppEnv>, body: ExperienciaBody, criando: boolean) {
  const patch: Record<string, unknown> = {}

  for (const [campo, limite] of Object.entries(TEXTOS)) {
    if (body[campo] === undefined) continue
    const valor = body[campo]
    if (valor !== null && typeof valor !== 'string') return { erro: `${campo} deve ser texto` }
    const texto = typeof valor === 'string' ? valor.trim() : ''
    if (texto.length > limite) return { erro: `${campo} deve ter no máximo ${limite} caracteres` }
    patch[campo] = texto || null
  }
  if (criando && !patch.nome) return { erro: 'Campo obrigatório: nome' }
  if (!criando && body.nome !== undefined && !patch.nome) return { erro: 'O nome não pode ficar vazio' }

  if (body.preco_a_partir !== undefined) {
    const preco = body.preco_a_partir
    if (preco !== null && (typeof preco !== 'number' || preco < 0 || !Number.isFinite(preco))) return { erro: 'Preço inválido' }
    patch.preco_a_partir = preco
  }
  if (body.nivel_dificuldade !== undefined) {
    if (body.nivel_dificuldade !== null && !NIVEIS.includes(body.nivel_dificuldade as string)) return { erro: 'Nível de dificuldade inválido' }
    patch.nivel_dificuldade = body.nivel_dificuldade
  }
  for (const campo of ['requer_acompanhamento', 'ativo']) {
    if (body[campo] === undefined) continue
    if (typeof body[campo] !== 'boolean') return { erro: `${campo} deve ser verdadeiro ou falso` }
    patch[campo] = body[campo]
  }
  if (body.ordem !== undefined) {
    if (!Number.isInteger(body.ordem)) return { erro: 'ordem deve ser um número inteiro' }
    patch.ordem = body.ordem
  }
  if (body.acessibilidades !== undefined) {
    if (!Array.isArray(body.acessibilidades)) return { erro: 'acessibilidades deve ser uma lista' }
    const opcoes = await carregarOpcoesValidas(c.get('supabase'))
    const invalidos = codigosInvalidos(body.acessibilidades as string[], opcoes.recursos)
    if (invalidos.length) return { erro: `Recursos de acessibilidade inválidos: ${invalidos.join(', ')}` }
    patch.acessibilidades = [...new Set(body.acessibilidades as string[])]
  }
  return { patch }
}

export async function criarExperiencia(c: Context<AppEnv>) {
  const supabase = c.get('supabase')
  const paginaId = c.req.param('id') as string
  const body = await c.req.json<ExperienciaBody>().catch(() => null)
  if (!body) return c.json({ error: 'Corpo da requisição inválido' }, 400)

  const { patch, erro } = await montarPatch(c, body, true)
  if (erro) return c.json({ error: erro }, 400)

  const { data: ultima } = await supabase.from('experiencias').select('ordem').eq('pagina_id', paginaId).order('ordem', { ascending: false }).limit(1)
  const { data, error } = await supabase
    .from('experiencias')
    .insert({ ...patch, pagina_id: paginaId, ordem: patch!.ordem ?? (ultima?.[0]?.ordem ?? 0) + 1 })
    .select('*')
    .single()

  if (error) return c.json({ error: error.message }, 400)
  return c.json(data, 201)
}

export async function atualizarExperiencia(c: Context<AppEnv>) {
  const supabase = c.get('supabase')
  const paginaId = c.req.param('id') as string
  const experienciaId = c.req.param('experienciaId') as string
  const body = await c.req.json<ExperienciaBody>().catch(() => null)
  if (!body) return c.json({ error: 'Corpo da requisição inválido' }, 400)

  const { patch, erro } = await montarPatch(c, body, false)
  if (erro) return c.json({ error: erro }, 400)

  const { data, error } = await supabase
    .from('experiencias')
    .update({ ...patch, updated_at: new Date().toISOString() })
    .eq('id', experienciaId)
    .eq('pagina_id', paginaId)
    .select('*')
    .single()

  if (error) return c.json({ error: 'Experiência não encontrada ou sem acesso' }, 404)
  return c.json(data)
}

export async function removerExperiencia(c: Context<AppEnv>) {
  const supabase = c.get('supabase')
  const paginaId = c.req.param('id') as string
  const experienciaId = c.req.param('experienciaId') as string

  const { error, count } = await supabase.from('experiencias').delete({ count: 'exact' }).eq('id', experienciaId).eq('pagina_id', paginaId)
  if (error) return c.json({ error: error.message }, 400)
  if (!count) return c.json({ error: 'Experiência não encontrada ou sem acesso' }, 404)
  return c.body(null, 204)
}

export async function uploadImagemExperiencia(c: Context<AppEnv>) {
  const supabase = c.get('supabase')
  const paginaId = c.req.param('id') as string
  const experienciaId = c.req.param('experienciaId') as string
  const body = await c.req.json<{ imagem_base64?: string; extensao?: string }>().catch(() => null)
  if (!body?.imagem_base64 || !body.extensao) return c.json({ error: 'Campos obrigatórios: imagem_base64, extensao' }, 400)

  const { url, erro } = await uploadFotoPagina(supabase, paginaId, `experiencia-${experienciaId}-${Date.now()}`, body.imagem_base64, body.extensao)
  if (erro) return c.json({ error: erro }, 400)

  const { data, error } = await supabase
    .from('experiencias')
    .update({ imagem_url: url, updated_at: new Date().toISOString() })
    .eq('id', experienciaId)
    .eq('pagina_id', paginaId)
    .select('imagem_url')
    .single()
  if (error) return c.json({ error: 'Experiência não encontrada ou sem acesso' }, 404)
  return c.json(data)
}
