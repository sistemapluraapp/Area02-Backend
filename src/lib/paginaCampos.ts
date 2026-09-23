import type { OpcoesArea } from './catalogo'
import { codigosInvalidos } from './catalogo'
import {
  CAMPOS_SEGURANCA,
  cnpjValido,
  normalizarWhatsapp,
  somenteDigitos,
  urlValida,
  validarHorarios,
  validarObjetoDeTextos,
  youtubeValido,
} from './validacao'

// Montagem e validação dos campos editáveis da página do empreendimento
// (compartilhado Áreas 02/03).

export const PAGINA_COLUNAS = [
  'id, tipo, nome, subtitulo, descricao_curta, descricao, slogan, diferencial, categoria, faixa_preco, tags, tema',
  'cnpj, legado, whatsapp, instagram, website, youtube, facebook, tiktok, video_apresentacao',
  'cep, endereco, cidade, uf, complemento, latitude, longitude',
  'ponto_referencia, como_chegar_carro, como_chegar_transporte, rota_acessivel',
  'horarios, feriados, requer_agendamento, tempo_medio, antecedencia',
  'logo_url, capa_url, recursos_acessibilidade, destaques_acessibilidade, observacoes_recursos',
  'antes_de_ir, antes_de_ir_observacoes, seguranca, suspensa, created_at, updated_at',
].join(', ')

export const TEMAS = ['plura', 'azul_claro', 'azul_escuro', 'verde', 'amarelo', 'rosa', 'branca', 'marrom', 'cinza']

// Campos de texto livre e seus limites de tamanho
const TEXTOS: Record<string, number> = {
  nome: 120,
  subtitulo: 80,
  descricao_curta: 200,
  descricao: 10000,
  slogan: 140,
  diferencial: 400,
  cep: 9,
  endereco: 200,
  cidade: 100,
  uf: 2,
  complemento: 120,
  instagram: 200,
  website: 300,
  youtube: 300,
  facebook: 300,
  tiktok: 300,
  ponto_referencia: 300,
  como_chegar_carro: 2000,
  como_chegar_transporte: 2000,
  rota_acessivel: 2000,
  feriados: 1000,
  tempo_medio: 80,
  antecedencia: 80,
  antes_de_ir_observacoes: 1000,
}

export type PaginaBody = Record<string, unknown>

export interface PaginaAtual {
  cnpj: string | null
  recursos_acessibilidade: string[]
}

type Resultado = { patch: Record<string, unknown>; erro?: undefined } | { erro: string; patch?: undefined }

function listaDeTexto(valor: unknown): string[] | null {
  if (!Array.isArray(valor) || valor.some((v) => typeof v !== 'string')) return null
  return [...new Set(valor as string[])]
}

export function montarPatch(body: PaginaBody, opcoes: OpcoesArea, atual: PaginaAtual | null): Resultado {
  const patch: Record<string, unknown> = {}
  const criando = atual === null

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
  if (patch.uf) patch.uf = String(patch.uf).toUpperCase()

  // CNPJ: obrigatório na criação; depois de definido não pode ser trocado
  if (body.cnpj !== undefined) {
    if (!criando && atual?.cnpj) return { erro: 'O CNPJ não pode ser alterado depois de cadastrado' }
    if (typeof body.cnpj !== 'string' || !cnpjValido(body.cnpj)) return { erro: 'CNPJ inválido. Confira os 14 dígitos.' }
    patch.cnpj = somenteDigitos(body.cnpj)
  } else if (criando) {
    return { erro: 'Campo obrigatório: cnpj' }
  }

  if (body.whatsapp !== undefined) {
    if (body.whatsapp === null || body.whatsapp === '') patch.whatsapp = null
    else {
      const numero = typeof body.whatsapp === 'string' ? normalizarWhatsapp(body.whatsapp) : null
      if (!numero) return { erro: 'WhatsApp inválido. Informe DDD + número.' }
      patch.whatsapp = numero
    }
  }

  if (patch.website && !urlValida(String(patch.website))) {
    patch.website = `https://${patch.website}`
    if (!urlValida(String(patch.website))) return { erro: 'Site inválido' }
  }

  if (body.video_apresentacao !== undefined) {
    const url = typeof body.video_apresentacao === 'string' ? body.video_apresentacao.trim() : ''
    if (url && !youtubeValido(url)) return { erro: 'O vídeo de apresentação deve ser um link do YouTube' }
    patch.video_apresentacao = url || null
  }

  if (body.categoria !== undefined) {
    if (body.categoria === null || body.categoria === '') patch.categoria = null
    else if (typeof body.categoria !== 'string' || !opcoes.categorias.includes(body.categoria)) {
      return { erro: 'Categoria inválida para esta área' }
    } else patch.categoria = body.categoria
  }

  if (body.tema !== undefined) {
    if (typeof body.tema !== 'string' || !TEMAS.includes(body.tema)) return { erro: 'Cor da página inválida' }
    patch.tema = body.tema
  }

  if (body.faixa_preco !== undefined) {
    const faixa = body.faixa_preco
    if (faixa !== null && !(Number.isInteger(faixa) && (faixa as number) >= 1 && (faixa as number) <= 4)) {
      return { erro: 'Faixa de preço deve ser de 1 ($) a 4 ($$$$)' }
    }
    patch.faixa_preco = faixa
  }

  if (body.requer_agendamento !== undefined) {
    if (typeof body.requer_agendamento !== 'boolean') return { erro: 'requer_agendamento deve ser verdadeiro ou falso' }
    patch.requer_agendamento = body.requer_agendamento
  }

  const listas: [string, string[], string][] = [
    ['tags', opcoes.tags, 'Tags inválidas'],
    ['antes_de_ir', opcoes.antesDeIr, 'Itens de "Antes de ir" inválidos'],
    ['recursos_acessibilidade', opcoes.recursos, 'Recursos de acessibilidade inválidos'],
  ]
  for (const [campo, validos, mensagem] of listas) {
    if (body[campo] === undefined) continue
    const lista = listaDeTexto(body[campo])
    if (!lista) return { erro: `${campo} deve ser uma lista` }
    const invalidos = codigosInvalidos(lista, validos)
    if (invalidos.length) return { erro: `${mensagem}: ${invalidos.join(', ')}` }
    patch[campo] = lista
  }
  if (Array.isArray(patch.tags) && patch.tags.length > 10) return { erro: 'Escolha no máximo 10 tags' }

  const recursos = (patch.recursos_acessibilidade as string[] | undefined) ?? atual?.recursos_acessibilidade ?? []

  if (body.destaques_acessibilidade !== undefined) {
    const destaques = listaDeTexto(body.destaques_acessibilidade)
    if (!destaques) return { erro: 'destaques_acessibilidade deve ser uma lista' }
    if (destaques.length > 4) return { erro: 'Escolha no máximo 4 destaques de acessibilidade' }
    if (codigosInvalidos(destaques, recursos).length) return { erro: 'Os destaques precisam estar entre os recursos marcados' }
    patch.destaques_acessibilidade = destaques
  } else if (patch.recursos_acessibilidade) {
    // Desmarcou um recurso que era destaque: o destaque sai junto (tratado no update)
    patch._filtrar_destaques = recursos
  }

  if (body.observacoes_recursos !== undefined) {
    const erro = validarObjetoDeTextos(body.observacoes_recursos, 'observacoes_recursos')
    if (erro) return { erro }
    const obs = Object.fromEntries(
      Object.entries(body.observacoes_recursos as Record<string, string>)
        .map(([k, v]) => [k, v.trim().slice(0, 300)])
        .filter(([k, v]) => v && recursos.includes(k))
    )
    patch.observacoes_recursos = obs
  }

  if (body.horarios !== undefined) {
    const erro = validarHorarios(body.horarios)
    if (erro) return { erro }
    patch.horarios = body.horarios
  }

  if (body.seguranca !== undefined) {
    const erro = validarObjetoDeTextos(body.seguranca, 'seguranca', CAMPOS_SEGURANCA)
    if (erro) return { erro }
    patch.seguranca = Object.fromEntries(
      Object.entries(body.seguranca as Record<string, string>)
        .map(([k, v]) => [k, v.trim().slice(0, 2000)])
        .filter(([, v]) => v)
    )
  }

  return { patch }
}
