import type { Context } from 'hono'
import type { AppEnv } from '../types'
import { uploadFotoPagina } from '../lib/fotos'

const CATEGORIAS = [
  'hotel',
  'hostel',
  'pousada',
  'bar',
  'restaurante',
  'cafe',
  'espaco_eventos',
  'passeio_turistico',
  'museu',
  'parque',
  'academia',
  'clinica',
  'outros',
]

const RECURSOS = [
  'rampa',
  'elevador',
  'banheiro_adaptado',
  'vaga_pcd',
  'piso_tatil',
  'libras',
  'braille',
  'cadeira_rodas',
  'audiodescricao',
  'entrada_acessivel',
]

const PAGINA_COLUNAS =
  'id, tipo, nome, descricao, categoria, cep, endereco, cidade, uf, complemento, logo_url, capa_url, fotos_urls, recursos_acessibilidade, youtube, instagram, facebook, tiktok, website, created_at'

interface NovaPaginaBody {
  nome?: string
  descricao?: string
  categoria?: string
  cep?: string
  endereco?: string
  cidade?: string
  uf?: string
  complemento?: string
  recursos_acessibilidade?: string[]
  youtube?: string
  instagram?: string
  facebook?: string
  tiktok?: string
  website?: string
}

function validarCategoria(categoria?: string): string | null {
  if (categoria === undefined) return null
  if (!CATEGORIAS.includes(categoria)) {
    return `Categoria inválida. Use uma das opções: ${CATEGORIAS.join(', ')}`
  }
  return null
}

function validarRecursosAcessibilidade(recursos?: string[]): string | null {
  if (recursos === undefined) return null
  const invalidos = recursos.filter((r) => !RECURSOS.includes(r))
  if (invalidos.length > 0) {
    return `Recursos de acessibilidade inválidos: ${invalidos.join(', ')}. Use uma das opções: ${RECURSOS.join(', ')}`
  }
  return null
}

export async function criarPagina(c: Context<AppEnv>) {
  const supabase = c.get('supabase')
  const userId = c.get('userId')
  const body = await c.req.json<NovaPaginaBody>().catch(() => null)

  if (!body?.nome) {
    return c.json({ error: 'Campo obrigatório: nome' }, 400)
  }

  const erroCategoria = validarCategoria(body.categoria)
  if (erroCategoria) return c.json({ error: erroCategoria }, 400)

  const erroRecursos = validarRecursosAcessibilidade(body.recursos_acessibilidade)
  if (erroRecursos) return c.json({ error: erroRecursos }, 400)

  const { data, error } = await supabase
    .from('paginas')
    .insert({
      tipo: 'privada',
      nome: body.nome,
      descricao: body.descricao ?? null,
      categoria: body.categoria ?? null,
      cep: body.cep ?? null,
      endereco: body.endereco ?? null,
      cidade: body.cidade ?? null,
      uf: body.uf ?? null,
      complemento: body.complemento ?? null,
      recursos_acessibilidade: body.recursos_acessibilidade ?? [],
      youtube: body.youtube ?? null,
      instagram: body.instagram ?? null,
      facebook: body.facebook ?? null,
      tiktok: body.tiktok ?? null,
      website: body.website ?? null,
      criado_por_usuario: userId,
    })
    .select(PAGINA_COLUNAS)
    .single()

  if (error) return c.json({ error: error.message }, 400)

  // Nota: o vínculo de administrador para o criador é criado automaticamente
  // por um trigger no banco (trg_criar_vinculo_administrador) ao inserir a
  // página — inserir aqui de novo causaria violação de chave duplicada.

  return c.json(data, 201)
}

export async function minhasPaginas(c: Context<AppEnv>) {
  const supabase = c.get('supabase')
  const userId = c.get('userId')

  const { data, error } = await supabase
    .from('vinculos')
    .select(`papel, paginas(${PAGINA_COLUNAS})`)
    .eq('usuario_id', userId)

  if (error) return c.json({ error: error.message }, 500)
  return c.json({ paginas: data })
}

export async function obterPagina(c: Context<AppEnv>) {
  const supabase = c.get('supabase')
  const id = c.req.param('id')

  const { data: pagina, error } = await supabase.from('paginas').select(PAGINA_COLUNAS).eq('id', id).single()

  if (error) return c.json({ error: 'Página não encontrada ou sem acesso' }, 404)

  const [{ data: vinculos }, { data: avaliacoes }, { data: certificados }] = await Promise.all([
    supabase.from('vinculos').select('id, usuario_id, papel, created_at').eq('pagina_id', id),
    supabase
      .from('avaliacoes')
      .select('id, usuario_id, nota, comentario, resposta, respondido_em, sinalizada, created_at')
      .eq('pagina_id', id)
      .order('created_at', { ascending: false }),
    supabase.from('certificados').select('id, status, solicitado_em, avaliado_em').eq('pagina_id', id),
  ])

  return c.json({ ...pagina, vinculos: vinculos ?? [], avaliacoes: avaliacoes ?? [], certificados: certificados ?? [] })
}

export async function atualizarPagina(c: Context<AppEnv>) {
  const supabase = c.get('supabase')
  const id = c.req.param('id')
  const body = await c.req.json<NovaPaginaBody>().catch(() => null)

  const erroCategoria = validarCategoria(body?.categoria)
  if (erroCategoria) return c.json({ error: erroCategoria }, 400)

  const erroRecursos = validarRecursosAcessibilidade(body?.recursos_acessibilidade)
  if (erroRecursos) return c.json({ error: erroRecursos }, 400)

  const patch: Record<string, string | string[] | null> = {}
  if (body?.nome) patch.nome = body.nome
  if (body?.descricao !== undefined) patch.descricao = body.descricao ?? ''
  if (body?.categoria !== undefined) patch.categoria = body.categoria
  if (body?.cep !== undefined) patch.cep = body.cep
  if (body?.endereco !== undefined) patch.endereco = body.endereco
  if (body?.cidade !== undefined) patch.cidade = body.cidade
  if (body?.uf !== undefined) patch.uf = body.uf
  if (body?.complemento !== undefined) patch.complemento = body.complemento
  if (body?.recursos_acessibilidade !== undefined) patch.recursos_acessibilidade = body.recursos_acessibilidade
  if (body?.youtube !== undefined) patch.youtube = body.youtube
  if (body?.instagram !== undefined) patch.instagram = body.instagram
  if (body?.facebook !== undefined) patch.facebook = body.facebook
  if (body?.tiktok !== undefined) patch.tiktok = body.tiktok
  if (body?.website !== undefined) patch.website = body.website

  const { data, error } = await supabase.from('paginas').update(patch).eq('id', id).select(PAGINA_COLUNAS).single()

  if (error) return c.json({ error: error.message }, 400)
  return c.json(data)
}

export async function uploadLogo(c: Context<AppEnv>) {
  const supabase = c.get('supabase')
  const paginaId = c.req.param('id') as string
  const body = await c.req.json<{ imagem_base64?: string; extensao?: string }>().catch(() => null)

  if (!body?.imagem_base64 || !body.extensao) {
    return c.json({ error: 'Campos obrigatórios: imagem_base64, extensao' }, 400)
  }

  const { url, erro } = await uploadFotoPagina(supabase, paginaId, 'logo', body.imagem_base64, body.extensao)
  if (erro) return c.json({ error: erro }, 400)

  const { data, error } = await supabase.from('paginas').update({ logo_url: url }).eq('id', paginaId).select('logo_url').single()
  if (error) return c.json({ error: error.message }, 500)

  return c.json(data)
}

export async function uploadCapa(c: Context<AppEnv>) {
  const supabase = c.get('supabase')
  const paginaId = c.req.param('id') as string
  const body = await c.req.json<{ imagem_base64?: string; extensao?: string }>().catch(() => null)

  if (!body?.imagem_base64 || !body.extensao) {
    return c.json({ error: 'Campos obrigatórios: imagem_base64, extensao' }, 400)
  }

  const { url, erro } = await uploadFotoPagina(supabase, paginaId, 'capa', body.imagem_base64, body.extensao)
  if (erro) return c.json({ error: erro }, 400)

  const { data, error } = await supabase.from('paginas').update({ capa_url: url }).eq('id', paginaId).select('capa_url').single()
  if (error) return c.json({ error: error.message }, 500)

  return c.json(data)
}

export async function adicionarFoto(c: Context<AppEnv>) {
  const supabase = c.get('supabase')
  const paginaId = c.req.param('id') as string
  const body = await c.req.json<{ imagem_base64?: string; extensao?: string }>().catch(() => null)

  if (!body?.imagem_base64 || !body.extensao) {
    return c.json({ error: 'Campos obrigatórios: imagem_base64, extensao' }, 400)
  }

  const { data: atual, error: erroAtual } = await supabase.from('paginas').select('fotos_urls').eq('id', paginaId).single()
  if (erroAtual) return c.json({ error: erroAtual.message }, 404)
  if ((atual.fotos_urls ?? []).length >= 10) {
    return c.json({ error: 'Limite de 10 fotos por empreendimento atingido' }, 400)
  }

  const nomeArquivo = `foto-${Date.now()}`
  const { url, erro } = await uploadFotoPagina(supabase, paginaId, nomeArquivo, body.imagem_base64, body.extensao)
  if (erro) return c.json({ error: erro }, 400)

  const novasFotos = [...(atual.fotos_urls ?? []), url]
  const { data, error } = await supabase.from('paginas').update({ fotos_urls: novasFotos }).eq('id', paginaId).select('fotos_urls').single()
  if (error) return c.json({ error: error.message }, 500)

  return c.json(data, 201)
}

export async function removerFoto(c: Context<AppEnv>) {
  const supabase = c.get('supabase')
  const paginaId = c.req.param('id') as string
  const body = await c.req.json<{ url?: string }>().catch(() => null)

  if (!body?.url) {
    return c.json({ error: 'Campo obrigatório: url' }, 400)
  }

  const { data: atual, error: erroAtual } = await supabase.from('paginas').select('fotos_urls').eq('id', paginaId).single()
  if (erroAtual) return c.json({ error: erroAtual.message }, 404)

  const novasFotos = (atual.fotos_urls ?? []).filter((f: string) => f !== body.url)
  const { data, error } = await supabase.from('paginas').update({ fotos_urls: novasFotos }).eq('id', paginaId).select('fotos_urls').single()
  if (error) return c.json({ error: error.message }, 500)

  return c.json(data)
}
