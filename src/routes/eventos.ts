import type { Context } from 'hono'
import type { AppEnv } from '../types'
import { uploadFotoPagina } from '../lib/fotos'
import { carregarOpcoesValidas, codigosInvalidos } from '../lib/catalogo'
import { validarTextoRico } from '../lib/textoRico'

// Eventos da página (Etapa 7): aparecem na página pública e na agenda
// cultural; visitantes logados marcam "Tenho interesse".

const COLUNAS = 'id, pagina_id, titulo, descricao, imagem_url, link, inicio, fim, local_nome, endereco, pais, uf, cidade, gratuito, acessibilidades, publicado, total_interessados, criado_em, atualizado_em'
const TEXTOS: Record<string, number> = { titulo: 150, local_nome: 200, endereco: 200, cidade: 100, uf: 60 }

type EventoBody = Record<string, unknown>

function data(valor: unknown): Date | null | undefined {
  if (valor === undefined) return undefined
  if (valor === null || valor === '') return null
  if (typeof valor !== 'string') return undefined
  const d = new Date(valor)
  return Number.isNaN(d.getTime()) ? undefined : d
}

async function montarPatch(c: Context<AppEnv>, body: EventoBody, criando: boolean) {
  const patch: Record<string, unknown> = {}
  for (const [campo, limite] of Object.entries(TEXTOS)) {
    if (body[campo] === undefined) continue
    const valor = body[campo]
    if (valor !== null && typeof valor !== 'string') return { erro: `${campo} deve ser texto` }
    const texto = typeof valor === 'string' ? valor.trim() : ''
    if (texto.length > limite) return { erro: `${campo} deve ter no máximo ${limite} caracteres` }
    patch[campo] = texto || null
  }
  if (criando && !patch.titulo) return { erro: 'Informe o título do evento' }
  if (!criando && body.titulo !== undefined && !patch.titulo) return { erro: 'O título não pode ficar vazio' }

  if (body.descricao !== undefined) {
    const texto = typeof body.descricao === 'string' ? body.descricao.trim() : ''
    const erro = validarTextoRico('descricao', texto, 4000)
    if (erro) return { erro }
    patch.descricao = texto || null
  }
  if (body.link !== undefined) {
    const link = typeof body.link === 'string' ? body.link.trim() : ''
    if (link && !/^https?:\/\/\S+$/i.test(link)) return { erro: 'O link deve começar com https://' }
    if (link.length > 500) return { erro: 'Link muito longo' }
    patch.link = link || null
  }
  if (body.pais !== undefined) {
    if (typeof body.pais !== 'string' || !/^[A-Za-z]{2}$/.test(body.pais)) return { erro: 'País inválido' }
    patch.pais = body.pais.toUpperCase()
  }
  if (typeof patch.uf === 'string' && (patch.pais ?? 'BR') === 'BR') patch.uf = (patch.uf as string).toUpperCase()

  const inicio = data(body.inicio)
  const fim = data(body.fim)
  if (body.inicio !== undefined && !inicio) return { erro: 'Data e hora de início inválidas' }
  if (body.fim !== undefined && fim === undefined) return { erro: 'Data e hora de término inválidas' }
  if (criando && !inicio) return { erro: 'Informe a data e a hora de início' }
  if (inicio) patch.inicio = inicio.toISOString()
  if (fim !== undefined) patch.fim = fim ? fim.toISOString() : null
  if (inicio && fim && fim < inicio) return { erro: 'O término precisa ser depois do início' }

  for (const campo of ['gratuito', 'publicado']) {
    if (body[campo] === undefined) continue
    if (body[campo] !== null && typeof body[campo] !== 'boolean') return { erro: `${campo} deve ser verdadeiro ou falso` }
    patch[campo] = body[campo]
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

export async function listarEventos(c: Context<AppEnv>) {
  const { data: eventos, error } = await c.get('supabase').from('eventos').select(COLUNAS).eq('pagina_id', c.req.param('id') as string).order('inicio', { ascending: false })
  if (error) return c.json({ error: error.message }, 500)
  return c.json({ eventos: eventos ?? [] })
}

export async function criarEvento(c: Context<AppEnv>) {
  const supabase = c.get('supabase')
  const paginaId = c.req.param('id') as string
  const body = await c.req.json<EventoBody>().catch(() => null)
  if (!body) return c.json({ error: 'Corpo da requisição inválido' }, 400)
  const { patch, erro } = await montarPatch(c, body, true)
  if (erro) return c.json({ error: erro }, 400)

  // Sem local informado, o evento acontece no endereço da página
  if (!patch!.cidade) {
    const { data: pagina } = await supabase.from('paginas').select('pais, uf, cidade, endereco').eq('id', paginaId).maybeSingle()
    if (pagina) {
      patch!.pais = patch!.pais ?? pagina.pais
      patch!.uf = patch!.uf ?? pagina.uf
      patch!.cidade = pagina.cidade
      patch!.endereco = patch!.endereco ?? pagina.endereco
    }
  }

  const { data: evento, error } = await supabase.from('eventos').insert({ ...patch, pagina_id: paginaId }).select(COLUNAS).single()
  if (error) return c.json({ error: error.message.includes('row-level security') ? 'Sem permissão para criar eventos nesta página' : error.message }, 400)
  return c.json(evento, 201)
}

export async function atualizarEvento(c: Context<AppEnv>) {
  const body = await c.req.json<EventoBody>().catch(() => null)
  if (!body) return c.json({ error: 'Corpo da requisição inválido' }, 400)
  const { patch, erro } = await montarPatch(c, body, false)
  if (erro) return c.json({ error: erro }, 400)

  const { data: evento, error } = await c
    .get('supabase')
    .from('eventos')
    .update({ ...patch, atualizado_em: new Date().toISOString() })
    .eq('id', c.req.param('eventoId') as string)
    .eq('pagina_id', c.req.param('id') as string)
    .select(COLUNAS)
    .single()
  if (error) return c.json({ error: error.message.includes('violates check') ? 'O término precisa ser depois do início' : 'Evento não encontrado ou sem acesso' }, 404)
  return c.json(evento)
}

export async function removerEvento(c: Context<AppEnv>) {
  const { error, count } = await c
    .get('supabase')
    .from('eventos')
    .delete({ count: 'exact' })
    .eq('id', c.req.param('eventoId') as string)
    .eq('pagina_id', c.req.param('id') as string)
  if (error) return c.json({ error: error.message }, 400)
  if (!count) return c.json({ error: 'Evento não encontrado ou sem permissão (só administradores da página podem excluir)' }, 404)
  return c.body(null, 204)
}

export async function uploadImagemEvento(c: Context<AppEnv>) {
  const supabase = c.get('supabase')
  const paginaId = c.req.param('id') as string
  const eventoId = c.req.param('eventoId') as string
  const body = await c.req.json<{ imagem_base64?: string; extensao?: string }>().catch(() => null)
  if (!body?.imagem_base64 || !body.extensao) return c.json({ error: 'Campos obrigatórios: imagem_base64, extensao' }, 400)

  const { url, erro } = await uploadFotoPagina(supabase, paginaId, `evento-${eventoId}-${Date.now()}`, body.imagem_base64, body.extensao)
  if (erro) return c.json({ error: erro }, 400)

  const { data: evento, error } = await supabase
    .from('eventos')
    .update({ imagem_url: url, atualizado_em: new Date().toISOString() })
    .eq('id', eventoId)
    .eq('pagina_id', paginaId)
    .select('imagem_url')
    .single()
  if (error) return c.json({ error: 'Evento não encontrado ou sem acesso' }, 404)
  return c.json(evento)
}

// Relatório de interessados (nome, cidade e data; sem e-mail)
export async function interessadosEvento(c: Context<AppEnv>) {
  const { data: interessados, error } = await c.get('supabase').rpc('interessados_evento', { p_evento_id: c.req.param('eventoId') as string })
  if (error) return c.json({ error: error.message }, 400)
  return c.json({ interessados: interessados ?? [] })
}
