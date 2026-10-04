import type { Context } from 'hono'
import type { AppEnv } from '../types'
import { AREA_CONFIG } from '../lib/areaConfig'
import { pode } from '../lib/acesso'
import { meuAcesso } from './colaboradores'
import { carregarOpcoesValidas } from '../lib/catalogo'
import { uploadFotoPagina } from '../lib/fotos'
import { geocodificarEndereco } from '../lib/geocoding'
import { PAGINA_COLUNAS, montarPatch, type PaginaBody } from '../lib/paginaCampos'

// string (não literal) para as comparações compartilhadas entre as áreas
const TIPO_AREA: string = AREA_CONFIG.tipoPagina

const CAMPOS_ENDERECO = ['endereco', 'cidade', 'uf', 'cep', 'pais'] as const

function mensagemErroBanco(mensagem: string): { texto: string; status: 400 | 409 } {
  if (mensagem.includes('paginas_cnpj_unico')) {
    return { texto: 'Já existe um empreendimento cadastrado com este CNPJ', status: 409 }
  }
  return { texto: mensagem, status: 400 }
}

export async function criarPagina(c: Context<AppEnv>) {
  const supabase = c.get('supabase')
  const userId = c.get('userId')
  const body = await c.req.json<PaginaBody>().catch(() => null)
  if (!body) return c.json({ error: 'Corpo da requisição inválido' }, 400)
  if (TIPO_AREA === 'publica') {
    const { data: areas } = await supabase.rpc('minhas_areas').maybeSingle<{ eh_gov: boolean }>()
    if (!areas?.eh_gov) return c.json({ error: 'Só contas institucionais Gov criam páginas na Plura Gov', codigo: 'nao_gov' }, 403)
  }
  if (body.aceite_termos !== true) return c.json({ error: 'É preciso aceitar os termos e condições para criar a página' }, 400)

  const opcoes = await carregarOpcoesValidas(supabase)
  const resultado = montarPatch(body, opcoes, null)
  if (resultado.erro !== undefined) return c.json({ error: resultado.erro }, 400)
  const { _filtrar_destaques: _, ...campos } = resultado.patch

  const coordenadas = await geocodificarEndereco({
    endereco: campos.endereco as string | undefined,
    cidade: campos.cidade as string | undefined,
    uf: campos.uf as string | undefined,
    cep: campos.cep as string | undefined,
    pais: campos.pais as string | undefined,
  })

  const { data, error } = await supabase
    .from('paginas')
    .insert({
      ...campos,
      tipo: AREA_CONFIG.tipoPagina,
      [AREA_CONFIG.colunaCriador]: userId,
      termos_aceitos_em: new Date().toISOString(),
      latitude: coordenadas?.latitude ?? null,
      longitude: coordenadas?.longitude ?? null,
    })
    .select(PAGINA_COLUNAS)
    .single()

  if (error) {
    const { texto, status } = mensagemErroBanco(error.message)
    return c.json({ error: texto }, status)
  }

  // O vínculo de administrador para o criador é criado automaticamente por
  // um trigger no banco (trg_criar_vinculo_administrador).
  return c.json(data, 201)
}

export async function minhasPaginas(c: Context<AppEnv>) {
  const supabase = c.get('supabase')
  const userId = c.get('userId')

  // Usuários Plura podem colaborar em páginas Gov e vice-versa: o vínculo pode
  // estar em qualquer das duas colunas, mas cada área só lista as suas páginas.
  const [{ data, error }, { data: areas }] = await Promise.all([
    supabase
      .from('vinculos')
      .select(`papel, cargo, permissoes, paginas(${PAGINA_COLUNAS})`)
      .or(`usuario_id.eq.${userId},gov_conta_id.eq.${userId}`),
    supabase.rpc('minhas_areas').maybeSingle<{ b2b: number; gov: number; eh_gov: boolean }>(),
  ])

  if (error) return c.json({ error: error.message }, 500)
  const paginas = ((data ?? []) as unknown as { paginas: { tipo?: string } | null }[]).filter((v) => v.paginas?.tipo === TIPO_AREA)
  return c.json({
    paginas,
    // Para a mensagem "você não tem páginas aqui" com atalhos para a outra área
    outra_area: {
      nome: AREA_CONFIG.outraArea.nome,
      url: AREA_CONFIG.outraArea.url,
      total: TIPO_AREA === 'privada' ? (areas?.gov ?? 0) : (areas?.b2b ?? 0),
    },
    pode_criar: TIPO_AREA === 'privada' ? !areas?.eh_gov : !!areas?.eh_gov,
  })
}

export async function obterPagina(c: Context<AppEnv>) {
  const supabase = c.get('supabase')
  const id = c.req.param('id') as string

  const { data: pagina, error } = await supabase.from('paginas').select(PAGINA_COLUNAS).eq('id', id).single()
  if (error) return c.json({ error: 'Página não encontrada ou sem acesso' }, 404)

  const [{ data: vinculos }, { data: avaliacoes }, { data: certificados }, { data: midias }, { data: experiencias }] = await Promise.all([
    pode(c.get('acesso'), 'equipe')
      ? supabase.rpc('equipe_pagina', { p_pagina_id: id })
      : Promise.resolve({ data: [] }),
    supabase
      .from('avaliacoes')
      .select('id, usuario_id, nota, comentario, resposta, respondido_em, sinalizada, status, created_at')
      .eq('pagina_id', id)
      .order('created_at', { ascending: false }),
    supabase.from('certificados').select('id, status, solicitado_em, avaliado_em').eq('pagina_id', id),
    supabase
      .from('pagina_midias')
      .select('id, tipo, url, plataforma, formato, categoria, legenda, texto_alt, ordem, created_at')
      .eq('pagina_id', id)
      .order('ordem', { ascending: true }),
    supabase.from('experiencias').select('*').eq('pagina_id', id).order('ordem', { ascending: true }),
  ])

  return c.json({
    ...(pagina as object),
    meu_acesso: meuAcesso(c),
    vinculos: vinculos ?? [],
    avaliacoes: avaliacoes ?? [],
    certificados: certificados ?? [],
    midias: midias ?? [],
    experiencias: experiencias ?? [],
  })
}

export async function atualizarPagina(c: Context<AppEnv>) {
  const supabase = c.get('supabase')
  const id = c.req.param('id') as string
  const body = await c.req.json<PaginaBody>().catch(() => null)
  if (!body) return c.json({ error: 'Corpo da requisição inválido' }, 400)

  const { data: atual, error: erroAtual } = await supabase
    .from('paginas')
    .select('cnpj, recursos_acessibilidade, destaques_acessibilidade, endereco, cidade, uf, cep, pais')
    .eq('id', id)
    .single()
  if (erroAtual || !atual) return c.json({ error: 'Página não encontrada ou sem acesso' }, 404)

  const opcoes = await carregarOpcoesValidas(supabase)
  const resultado = montarPatch(body, opcoes, atual)
  if (resultado.erro !== undefined) return c.json({ error: resultado.erro }, 400)
  const { _filtrar_destaques: recursosMarcados, ...patch } = resultado.patch

  if (Array.isArray(recursosMarcados)) {
    patch.destaques_acessibilidade = (atual.destaques_acessibilidade ?? []).filter((d: string) => recursosMarcados.includes(d))
  }

  if (CAMPOS_ENDERECO.some((campo) => patch[campo] !== undefined)) {
    const coordenadas = await geocodificarEndereco({
      endereco: (patch.endereco ?? atual.endereco) as string | null,
      cidade: (patch.cidade ?? atual.cidade) as string | null,
      uf: (patch.uf ?? atual.uf) as string | null,
      cep: (patch.cep ?? atual.cep) as string | null,
      pais: (patch.pais ?? atual.pais) as string | null,
    })
    if (coordenadas) {
      patch.latitude = coordenadas.latitude
      patch.longitude = coordenadas.longitude
    }
  }

  if (Object.keys(patch).length === 0) return c.json({ error: 'Nenhum campo para atualizar' }, 400)

  const { data, error } = await supabase.from('paginas').update(patch).eq('id', id).select(PAGINA_COLUNAS).single()
  if (error) {
    const { texto, status } = mensagemErroBanco(error.message)
    return c.json({ error: texto }, status)
  }
  return c.json(data)
}

// Lixeira: a página some do público na hora e é excluída de vez após 30 dias
// (cron da Área 04). Só administradores da página conseguem (RLS de update).
export async function excluirPagina(c: Context<AppEnv>) {
  const supabase = c.get('supabase')
  const id = c.req.param('id') as string
  const { data, error } = await supabase
    .from('paginas')
    .update({ excluida_em: new Date().toISOString() })
    .eq('id', id)
    .is('excluida_em', null)
    .select('id, excluida_em')
    .maybeSingle()
  if (error) return c.json({ error: error.message }, 500)
  if (!data) return c.json({ error: 'Página não encontrada, já na lixeira ou sem permissão de administrador' }, 404)
  return c.json(data)
}

export async function restaurarPagina(c: Context<AppEnv>) {
  const supabase = c.get('supabase')
  const id = c.req.param('id') as string
  const { data, error } = await supabase
    .from('paginas')
    .update({ excluida_em: null })
    .eq('id', id)
    .not('excluida_em', 'is', null)
    .select(PAGINA_COLUNAS)
    .maybeSingle()
  if (error) return c.json({ error: error.message }, 500)
  if (!data) return c.json({ error: 'Página não encontrada na lixeira ou sem permissão de administrador' }, 404)
  return c.json(data)
}

async function enviarImagemPrincipal(c: Context<AppEnv>, campo: 'logo_url' | 'capa_url', nomeArquivo: string) {
  const supabase = c.get('supabase')
  const paginaId = c.req.param('id') as string
  const body = await c.req.json<{ imagem_base64?: string; extensao?: string }>().catch(() => null)

  if (!body?.imagem_base64 || !body.extensao) {
    return c.json({ error: 'Campos obrigatórios: imagem_base64, extensao' }, 400)
  }

  // Nome com carimbo de tempo: a URL muda a cada envio e o navegador não
  // mostra a imagem antiga do cache.
  const { url, erro } = await uploadFotoPagina(supabase, paginaId, `${nomeArquivo}-${Date.now()}`, body.imagem_base64, body.extensao)
  if (erro) return c.json({ error: erro }, 400)

  const { data, error } = await supabase.from('paginas').update({ [campo]: url }).eq('id', paginaId).select(campo).single()
  if (error) return c.json({ error: error.message }, 500)
  return c.json(data)
}

export function uploadLogo(c: Context<AppEnv>) {
  return enviarImagemPrincipal(c, 'logo_url', 'logo')
}

export function uploadCapa(c: Context<AppEnv>) {
  return enviarImagemPrincipal(c, 'capa_url', 'capa')
}
