import type { Context } from 'hono'
import type { AppEnv } from '../types'
import { uploadFotoPagina } from '../lib/fotos'
import { plataformaDoLink, urlValida } from '../lib/validacao'

// Galeria do empreendimento: fotos enviadas (até 15) e links externos
// (vídeos, reels, fotos 360° e tours virtuais).

const LIMITE_FOTOS = 15
const FORMATOS = ['video', 'reel', 'foto_360', 'tour_virtual']
const CATEGORIAS = ['ambiente', 'entrada', 'banheiros', 'quartos', 'cardapio', 'equipe', 'equipamentos', 'trilhas', 'piscina', 'area_externa', 'acessibilidade']
const COLUNAS = 'id, tipo, url, plataforma, formato, categoria, legenda, texto_alt, ordem, created_at'

interface MidiaBody {
  imagem_base64?: string
  extensao?: string
  url?: string
  formato?: string
  categoria?: string | null
  legenda?: string | null
  texto_alt?: string | null
  ordem?: number
}

function validarMetadados(body: MidiaBody): string | null {
  if (body.categoria && !CATEGORIAS.includes(body.categoria)) return 'Categoria da mídia inválida'
  if (body.legenda && body.legenda.length > 200) return 'A legenda deve ter no máximo 200 caracteres'
  if (body.texto_alt && body.texto_alt.length > 300) return 'O texto alternativo deve ter no máximo 300 caracteres'
  return null
}

async function proximaOrdem(c: Context<AppEnv>, paginaId: string) {
  const { data } = await c.get('supabase').from('pagina_midias').select('ordem').eq('pagina_id', paginaId).order('ordem', { ascending: false }).limit(1)
  return (data?.[0]?.ordem ?? 0) + 1
}

export async function adicionarFoto(c: Context<AppEnv>) {
  const supabase = c.get('supabase')
  const paginaId = c.req.param('id') as string
  const body = await c.req.json<MidiaBody>().catch(() => null)

  if (!body?.imagem_base64 || !body.extensao) return c.json({ error: 'Campos obrigatórios: imagem_base64, extensao' }, 400)
  // A descrição é o que um leitor de tela lê no lugar da foto.
  if ((body.texto_alt?.trim().length ?? 0) < 5) {
    return c.json({ error: 'Descreva a foto (mínimo 5 caracteres) para que pessoas cegas saibam o que ela mostra' }, 400)
  }
  const erroMeta = validarMetadados(body)
  if (erroMeta) return c.json({ error: erroMeta }, 400)

  const { count } = await supabase.from('pagina_midias').select('id', { count: 'exact', head: true }).eq('pagina_id', paginaId).eq('tipo', 'foto')
  if ((count ?? 0) >= LIMITE_FOTOS) return c.json({ error: `Limite de ${LIMITE_FOTOS} fotos por empreendimento atingido` }, 400)

  const { url, erro } = await uploadFotoPagina(supabase, paginaId, `foto-${Date.now()}`, body.imagem_base64, body.extensao)
  if (erro || !url) return c.json({ error: erro ?? 'Erro ao enviar a foto' }, 400)

  const { data, error } = await supabase
    .from('pagina_midias')
    .insert({
      pagina_id: paginaId,
      tipo: 'foto',
      url,
      categoria: body.categoria ?? null,
      legenda: body.legenda?.trim() || null,
      texto_alt: body.texto_alt?.trim() || null,
      ordem: await proximaOrdem(c, paginaId),
    })
    .select(COLUNAS)
    .single()

  if (error) return c.json({ error: error.message }, 400)
  return c.json(data, 201)
}

export async function adicionarLink(c: Context<AppEnv>) {
  const supabase = c.get('supabase')
  const paginaId = c.req.param('id') as string
  const body = await c.req.json<MidiaBody>().catch(() => null)

  const url = body?.url?.trim()
  if (!url || !urlValida(url)) return c.json({ error: 'Informe um link válido (começando com https://)' }, 400)
  if (!body?.formato || !FORMATOS.includes(body.formato)) return c.json({ error: `formato deve ser: ${FORMATOS.join(', ')}` }, 400)
  const erroMeta = validarMetadados(body)
  if (erroMeta) return c.json({ error: erroMeta }, 400)

  const { data, error } = await supabase
    .from('pagina_midias')
    .insert({
      pagina_id: paginaId,
      tipo: 'link',
      url,
      plataforma: plataformaDoLink(url),
      formato: body.formato,
      categoria: body.categoria ?? null,
      legenda: body.legenda?.trim() || null,
      texto_alt: body.texto_alt?.trim() || null,
      ordem: await proximaOrdem(c, paginaId),
    })
    .select(COLUNAS)
    .single()

  if (error) return c.json({ error: error.message }, 400)
  return c.json(data, 201)
}

export async function atualizarMidia(c: Context<AppEnv>) {
  const supabase = c.get('supabase')
  const paginaId = c.req.param('id') as string
  const midiaId = c.req.param('midiaId') as string
  const body = await c.req.json<MidiaBody>().catch(() => null)
  if (!body) return c.json({ error: 'Corpo da requisição inválido' }, 400)

  const erroMeta = validarMetadados(body)
  if (erroMeta) return c.json({ error: erroMeta }, 400)
  if (body.formato !== undefined && !FORMATOS.includes(body.formato)) return c.json({ error: 'Formato inválido' }, 400)

  const patch: Record<string, unknown> = {}
  if (body.categoria !== undefined) patch.categoria = body.categoria || null
  if (body.legenda !== undefined) patch.legenda = body.legenda?.trim() || null
  if (body.texto_alt !== undefined) patch.texto_alt = body.texto_alt?.trim() || null
  if (body.formato !== undefined) patch.formato = body.formato
  if (body.ordem !== undefined) patch.ordem = body.ordem

  const { data, error } = await supabase.from('pagina_midias').update(patch).eq('id', midiaId).eq('pagina_id', paginaId).select(COLUNAS).single()
  if (error) return c.json({ error: 'Mídia não encontrada ou sem acesso' }, 404)
  return c.json(data)
}

export async function removerMidia(c: Context<AppEnv>) {
  const supabase = c.get('supabase')
  const paginaId = c.req.param('id') as string
  const midiaId = c.req.param('midiaId') as string

  const { data: midia } = await supabase.from('pagina_midias').select('tipo, url').eq('id', midiaId).eq('pagina_id', paginaId).single()
  if (!midia) return c.json({ error: 'Mídia não encontrada ou sem acesso' }, 404)

  const { error } = await supabase.from('pagina_midias').delete().eq('id', midiaId).eq('pagina_id', paginaId)
  if (error) return c.json({ error: error.message }, 400)

  // Remove o arquivo do storage (best-effort: a mídia já saiu da galeria)
  if (midia.tipo === 'foto') {
    const caminho = String(midia.url).split('/paginas-fotos/')[1]
    if (caminho) await supabase.storage.from('paginas-fotos').remove([decodeURIComponent(caminho)])
  }
  return c.body(null, 204)
}
