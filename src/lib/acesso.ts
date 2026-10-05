import type { Context, Next } from 'hono'
import type { AppEnv } from '../types'
import { AREA_CONFIG } from './areaConfig'

// Equipe da página: o administrador (dono) pode tudo; colaboradores só nas
// abas do editor marcadas em vinculos.permissoes. A regra vale aqui no
// backend e também no banco (RLS com internal.pode_editar).
export const ABAS = [
  'identidade',
  'aparencia',
  'acessibilidade',
  'localizacao',
  'horarios',
  'galeria',
  'experiencias',
  'eventos',
  'contato',
  'antes',
  'comentarios',
  'selos',
  'equipe',
] as const
export type Aba = (typeof ABAS)[number]

export const ROTULO_ABA: Record<Aba, string> = {
  identidade: 'Identidade',
  aparencia: 'Cor da página',
  acessibilidade: 'Acessibilidade',
  localizacao: 'Localização',
  horarios: 'Horários',
  galeria: 'Galeria',
  experiencias: 'Experiências',
  eventos: 'Eventos',
  contato: 'Contato',
  antes: 'Antes de ir e segurança',
  comentarios: 'Avaliações de nossos usuários',
  selos: 'Selos e certificações',
  equipe: 'Equipe e logs',
}

// Campo da página → aba do editor que o altera (PUT /paginas/:id)
const ABA_DO_CAMPO: Record<string, Aba> = {
  nome: 'identidade', subtitulo: 'identidade', descricao_curta: 'identidade', descricao: 'identidade',
  slogan: 'identidade', diferencial: 'identidade', categoria: 'identidade', faixa_preco: 'identidade',
  tags: 'identidade', cnpj: 'identidade', video_apresentacao: 'identidade',
  tema: 'aparencia',
  recursos_acessibilidade: 'acessibilidade', destaques_acessibilidade: 'acessibilidade',
  observacoes_recursos: 'acessibilidade', como_e_o_lugar: 'acessibilidade', video_libras: 'acessibilidade',
  pais: 'localizacao', cep: 'localizacao', endereco: 'localizacao', cidade: 'localizacao', uf: 'localizacao',
  complemento: 'localizacao', ponto_referencia: 'localizacao', como_chegar_carro: 'localizacao',
  como_chegar_transporte: 'localizacao', rota_acessivel: 'localizacao', mapa_link: 'localizacao',
  localizacao_comentarios: 'localizacao',
  horarios: 'horarios', feriados: 'horarios', requer_agendamento: 'horarios', tempo_medio: 'horarios',
  antecedencia: 'horarios',
  whatsapp: 'contato', instagram: 'contato', website: 'contato', youtube: 'contato', facebook: 'contato',
  tiktok: 'contato', contatos: 'contato',
  antes_de_ir: 'antes', antes_de_ir_observacoes: 'antes', seguranca: 'antes',
}

export function abasDosCampos(campos: string[]): Aba[] {
  return [...new Set(campos.map((campo) => ABA_DO_CAMPO[campo] ?? 'identidade'))]
}

export interface Acesso {
  vinculoId: string
  papel: 'administrador' | 'colaborador'
  permissoes: string[]
  cargo: string | null
}

export function pode(acesso: Acesso, aba: Aba): boolean {
  return acesso.papel === 'administrador' || acesso.permissoes.includes(aba)
}

export function abasPermitidas(acesso: Acesso): Aba[] {
  return ABAS.filter((aba) => pode(acesso, aba))
}

// Confere se a página é desta área e se quem chama está na equipe.
export async function carregarAcesso(c: Context<AppEnv>, paginaId: string): Promise<Acesso | Response> {
  const supabase = c.get('supabase')
  const userId = c.get('userId')
  if (!/^[0-9a-f-]{36}$/i.test(paginaId)) return c.json({ error: 'Página não encontrada' }, 404)

  const [{ data: pagina }, { data: vinculo }] = await Promise.all([
    supabase.from('paginas').select('id, tipo').eq('id', paginaId).maybeSingle(),
    supabase
      .from('vinculos')
      .select('id, papel, permissoes, cargo')
      .eq('pagina_id', paginaId)
      .eq('status', 'ativo')
      .or(`usuario_id.eq.${userId},gov_conta_id.eq.${userId}`)
      .maybeSingle(),
  ])

  if (!pagina) return c.json({ error: 'Página não encontrada ou sem acesso' }, 404)
  if (pagina.tipo !== AREA_CONFIG.tipoPagina) {
    return c.json(
      {
        error: `Esta página é editada em ${AREA_CONFIG.outraArea.nome}. Entre por ${AREA_CONFIG.outraArea.url} para editá-la.`,
        codigo: 'outra_area',
        link: AREA_CONFIG.outraArea.url,
      },
      403,
    )
  }
  if (!vinculo) return c.json({ error: 'Você não faz parte da equipe desta página', codigo: 'sem_vinculo' }, 403)

  return {
    vinculoId: vinculo.id,
    papel: vinculo.papel,
    permissoes: vinculo.permissoes ?? [],
    cargo: vinculo.cargo ?? null,
  }
}

type Exigencia = { aba: Aba | 'qualquer' | 'admin' | 'campos'; acao?: string }

// O que cada rota /paginas/:id/... exige e como aparece no log
function exigencia(metodo: string, resto: string[]): Exigencia {
  const [recurso, , sub] = resto
  const escrita = metodo !== 'GET'
  if (!recurso) {
    if (metodo === 'GET') return { aba: 'qualquer' }
    if (metodo === 'PUT') return { aba: 'campos' }
    if (metodo === 'DELETE') return { aba: 'admin', acao: 'Moveu a página para a lixeira' }
    return { aba: 'admin' }
  }
  switch (recurso) {
    case 'restaurar':
      return { aba: 'admin', acao: 'Restaurou a página da lixeira' }
    case 'logo':
      return { aba: 'identidade', acao: 'Trocou o logotipo' }
    case 'capa':
      return { aba: 'identidade', acao: 'Trocou a imagem de capa' }
    case 'midias':
      return {
        aba: 'galeria',
        acao: metodo === 'POST' ? `Adicionou ${resto[1] === 'link' ? 'um link' : 'uma foto'} na galeria`
          : metodo === 'DELETE' ? 'Removeu um item da galeria' : 'Editou um item da galeria',
      }
    case 'experiencias':
      return {
        aba: 'experiencias',
        acao: sub === 'imagem' ? 'Trocou a imagem de uma experiência'
          : metodo === 'POST' ? 'Criou uma experiência' : metodo === 'DELETE' ? 'Removeu uma experiência' : 'Editou uma experiência',
      }
    case 'eventos':
      return {
        aba: 'eventos',
        acao: !escrita ? undefined : sub === 'imagem' ? 'Trocou a imagem de um evento'
          : metodo === 'POST' ? 'Criou um evento' : metodo === 'DELETE' ? 'Removeu um evento' : 'Editou um evento',
      }
    case 'colaboradores':
    case 'logs':
      return { aba: 'equipe', acao: escrita ? 'Alterou a equipe' : undefined }
    case 'inscricoes':
      // As funções do banco registram no log o início, o envio e o cancelamento
      return escrita ? { aba: 'selos' } : { aba: 'qualquer' }
    case 'certificados':
      return escrita ? { aba: 'selos', acao: 'Solicitou uma certificação' } : { aba: 'qualquer' }
    default:
      return { aba: 'admin' }
  }
}

export async function registrarLog(c: Context<AppEnv>, paginaId: string, acao: string) {
  try {
    await c.get('supabase').rpc('registrar_log_pagina', { p_pagina_id: paginaId, p_acao: acao })
  } catch (err) {
    console.error('Falha ao registrar log da página:', err)
  }
}

function negado(c: Context<AppEnv>, aba: Aba | 'admin') {
  const texto = aba === 'admin'
    ? 'Só o administrador da página pode fazer isso'
    : `Você não tem acesso à aba "${ROTULO_ABA[aba]}" desta página`
  return c.json({ error: texto, codigo: 'sem_permissao' }, 403)
}

// Middleware de /paginas/:id/*: área certa, equipe, permissão da aba e log.
export async function exigirAcessoPagina(c: Context<AppEnv>, next: Next) {
  const partes = c.req.path.split('/').filter(Boolean) // ['paginas', id, ...resto]
  const paginaId = partes[1]
  if (partes[0] !== 'paginas' || !paginaId) return next()

  const acesso = await carregarAcesso(c, paginaId)
  if (acesso instanceof Response) return acesso
  c.set('acesso', acesso)

  const metodo = c.req.method
  const regra = exigencia(metodo, partes.slice(2))
  let acao = regra.acao

  if (regra.aba === 'admin') {
    if (acesso.papel !== 'administrador') return negado(c, 'admin')
  } else if (regra.aba === 'campos') {
    const body = await c.req.json<Record<string, unknown>>().catch(() => null)
    const abas = abasDosCampos(Object.keys(body ?? {}))
    const proibida = abas.find((aba) => !pode(acesso, aba))
    if (proibida) return negado(c, proibida)
    acao = abas.length ? `Atualizou ${abas.map((aba) => ROTULO_ABA[aba]).join(', ')}` : undefined
  } else if (regra.aba !== 'qualquer' && !pode(acesso, regra.aba)) {
    return negado(c, regra.aba)
  }

  await next()

  if (metodo !== 'GET' && c.res.status < 300) {
    const texto = c.get('acaoLog') ?? acao
    if (texto) await registrarLog(c, paginaId, texto)
  }
}
