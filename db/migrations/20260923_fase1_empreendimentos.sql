-- =============================================================================
-- Fase 1 — Reformulação das páginas de empreendimento
--
-- Migration ADITIVA: não remove colunas, tabelas nem dados. Colunas antigas
-- que deixam de ser usadas pela interface (fotos_urls, youtube, facebook,
-- tiktok) continuam no banco.
--
-- Aplicada no Supabase grupo01-useast2 (uoembacxxnkuwldmdgcu).
-- =============================================================================

-- -----------------------------------------------------------------------------
-- 1. Catálogo genérico gerenciado pela Área 04
--    tipo: categoria | tag | preferencia_turismo | antes_de_ir
--    escopo: b2b (Área 02) | b2g (Área 03) | ambos
--    icone: nome de ícone Tabler em kebab-case (ex.: 'wheelchair')
-- -----------------------------------------------------------------------------
create table public.catalogo_itens (
  id uuid primary key default gen_random_uuid(),
  tipo text not null check (tipo in ('categoria', 'tag', 'preferencia_turismo', 'antes_de_ir')),
  codigo text not null check (codigo ~ '^[a-z0-9_]+$'),
  rotulo text not null,
  icone text,
  escopo text not null default 'ambos' check (escopo in ('b2b', 'b2g', 'ambos')),
  ordem int not null default 0,
  ativo boolean not null default true,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (tipo, codigo)
);

alter table public.catalogo_itens enable row level security;
create policy catalogo_itens_select_public on public.catalogo_itens for select using (true);
create policy area04_write_catalogo_itens on public.catalogo_itens for all to area04_backend using (true) with check (true);
grant select, insert, update, delete on public.catalogo_itens to area04_backend;

-- Categorias: união da lista atual com a da especificação
insert into public.catalogo_itens (tipo, codigo, rotulo, icone, escopo, ordem) values
  ('categoria', 'restaurante',          'Restaurante',          'tools-kitchen-2',     'ambos', 1),
  ('categoria', 'hotel',                'Hotel',                'building-skyscraper', 'b2b',   2),
  ('categoria', 'pousada',              'Pousada',              'building-cottage',    'b2b',   3),
  ('categoria', 'resort',               'Resort',               'pool',                'b2b',   4),
  ('categoria', 'hostel',               'Hostel',               'bed',                 'b2b',   5),
  ('categoria', 'bar',                  'Bar',                  'glass-full',          'b2b',   6),
  ('categoria', 'cafe',                 'Café',                 'coffee',              'b2b',   7),
  ('categoria', 'passeio_turistico',    'Passeio',              'map-route',           'ambos', 8),
  ('categoria', 'parque',               'Parque',               'trees',               'ambos', 9),
  ('categoria', 'praia',                'Praia',                'beach',               'b2g',  10),
  ('categoria', 'agencia',              'Agência de turismo',   'plane',               'b2b',  11),
  ('categoria', 'museu',                'Museu',                'building-monument',   'ambos',12),
  ('categoria', 'atracao_turistica',    'Atração turística',    'camera',              'ambos',13),
  ('categoria', 'transporte_turistico', 'Transporte turístico', 'bus',                 'ambos',14),
  ('categoria', 'evento',               'Evento',               'confetti',            'ambos',15),
  ('categoria', 'espaco_eventos',       'Espaço de eventos',    'building-community',  'ambos',16),
  ('categoria', 'academia',             'Academia',             'barbell',             'b2b',  17),
  ('categoria', 'clinica',              'Clínica',              'stethoscope',         'b2b',  18),
  ('categoria', 'outros',               'Outro',                'dots',                'ambos',99);

insert into public.catalogo_itens (tipo, codigo, rotulo, icone, ordem) values
  ('tag', 'gastronomia_regional', 'Gastronomia regional', 'tools-kitchen-2', 1),
  ('tag', 'inclusao',             'Inclusão',             'heart-handshake', 2),
  ('tag', 'cultura_local',        'Cultura local',        'palette',         3),
  ('tag', 'familia',              'Família',              'friends',         4),
  ('tag', 'natureza',             'Natureza',             'leaf',            5),
  ('tag', 'aventura',             'Aventura',             'compass',         6),
  ('tag', 'praia',                'Praia',                'beach',           7),
  ('tag', 'ecoturismo',           'Ecoturismo',           'plant',           8);

insert into public.catalogo_itens (tipo, codigo, rotulo, icone, ordem) values
  ('preferencia_turismo', 'passeio',           'Passeio',           'map-route',       1),
  ('preferencia_turismo', 'trilha',            'Trilha',            'trekking',        2),
  ('preferencia_turismo', 'restaurantes',      'Restaurantes',      'tools-kitchen-2', 3),
  ('preferencia_turismo', 'resorts',           'Resorts',           'pool',            4),
  ('preferencia_turismo', 'praias',            'Praias',            'beach',           5),
  ('preferencia_turismo', 'eventos_culturais', 'Eventos culturais', 'palette',         6),
  ('preferencia_turismo', 'festas',            'Festas',            'confetti',        7);

insert into public.catalogo_itens (tipo, codigo, rotulo, icone, ordem) values
  ('antes_de_ir', 'agendamento_necessario', 'É necessário agendamento',        'calendar-check', 1),
  ('antes_de_ir', 'levar_documento',        'Levar documento',                 'id',             2),
  ('antes_de_ir', 'equipamento_fornecido',  'Equipamento fornecido pelo local','tool',           3),
  ('antes_de_ir', 'acompanhante_permitido', 'Acompanhante permitido',          'friends',        4),
  ('antes_de_ir', 'cao_guia_permitido',     'Cão-guia permitido',              'dog',            5),
  ('antes_de_ir', 'chegar_antecedencia',    'Chegar 30 minutos antes',         'clock',          6);

-- -----------------------------------------------------------------------------
-- 2. Grupos de acessibilidade (Nível de acessibilidade = % de itens marcados)
-- -----------------------------------------------------------------------------
create table public.grupos_acessibilidade (
  codigo text primary key check (codigo ~ '^[a-z0-9_]+$'),
  rotulo text not null,
  descricao text,
  icone text,
  ordem int not null default 0,
  ativo boolean not null default true,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

alter table public.grupos_acessibilidade enable row level security;
create policy grupos_acessibilidade_select_public on public.grupos_acessibilidade for select using (true);
create policy area04_write_grupos_acessibilidade on public.grupos_acessibilidade for all to area04_backend using (true) with check (true);
grant select, insert, update, delete on public.grupos_acessibilidade to area04_backend;

insert into public.grupos_acessibilidade (codigo, rotulo, descricao, icone, ordem) values
  ('fisica',      'Acessibilidade física',  'Mobilidade, circulação e estrutura do local',            'wheelchair',       1),
  ('comunicacao', 'Comunicação',            'Libras e comunicação para pessoas surdas',                'message-language', 2),
  ('visual',      'Deficiência visual',     'Recursos para pessoas cegas ou com baixa visão',          'eye',              3),
  ('sensorial',   'Sensorial e cognitiva',  'Neurodivergência, acessibilidade cognitiva e sensorial',  'brain',            4),
  ('apoio',       'Serviços e apoio',       'Atendimento, equipe e serviços de apoio',                 'heart-handshake',  5);

-- -----------------------------------------------------------------------------
-- 3. filtros_acessibilidade: ícone, descrição e escopo. Para tipo
--    'recurso_local', a coluna categoria passa a ser o código do grupo.
--    Os códigos existentes não mudam (páginas e buscas continuam válidas).
-- -----------------------------------------------------------------------------
alter table public.filtros_acessibilidade
  add column icone text,
  add column descricao text,
  add column escopo text not null default 'ambos' check (escopo in ('b2b', 'b2g', 'ambos'));

update public.filtros_acessibilidade set categoria = 'fisica'
  where tipo = 'recurso_local' and codigo in ('rampa', 'elevador', 'banheiro_adaptado', 'vaga_pcd', 'cadeira_rodas', 'entrada_acessivel');
update public.filtros_acessibilidade set categoria = 'visual'
  where tipo = 'recurso_local' and codigo in ('piso_tatil', 'braille', 'audiodescricao');
update public.filtros_acessibilidade set categoria = 'comunicacao'
  where tipo = 'recurso_local' and codigo = 'libras';

update public.filtros_acessibilidade f set icone = v.icone, rotulo = coalesce(v.rotulo, f.rotulo)
from (values
  ('rampa',             'trending-up',   'Rampas'),
  ('elevador',          'elevator',      null),
  ('banheiro_adaptado', 'toilet-paper',  null),
  ('vaga_pcd',          'parking',       'Estacionamento acessível'),
  ('cadeira_rodas',     'wheelchair',    null),
  ('entrada_acessivel', 'door-enter',    null),
  ('piso_tatil',        'road',          null),
  ('braille',           'braille',       null),
  ('audiodescricao',    'headphones',    null),
  ('libras',            'hand-finger',   null)
) as v(codigo, icone, rotulo)
where f.tipo = 'recurso_local' and f.codigo = v.codigo;

insert into public.filtros_acessibilidade (tipo, categoria, codigo, rotulo, icone, ordem) values
  -- física
  ('recurso_local', 'fisica',      'entrada_sem_degraus',     'Entrada sem degraus',               'door-enter',       20),
  ('recurso_local', 'fisica',      'portas_largas',           'Portas largas',                     'arrows-horizontal',21),
  ('recurso_local', 'fisica',      'barras_apoio',            'Barras de apoio',                   'grip-horizontal',  22),
  ('recurso_local', 'fisica',      'rampa_movel',             'Rampa móvel',                       'trending-up',      23),
  ('recurso_local', 'fisica',      'cadeira_rodas_disponivel','Cadeira de rodas disponível',       'wheelchair',       24),
  ('recurso_local', 'fisica',      'cadeira_anfibia',         'Cadeira anfíbia',                   'swimming',         25),
  ('recurso_local', 'fisica',      'mergulho_adaptado',       'Equipamento de mergulho adaptado',  'scuba-mask',       26),
  ('recurso_local', 'fisica',      'transporte_adaptado',     'Transporte adaptado',               'bus',              27),
  -- comunicação
  ('recurso_local', 'comunicacao', 'interprete_libras',       'Intérprete de Libras',              'hand-finger',      30),
  ('recurso_local', 'comunicacao', 'cardapio_libras',         'Cardápio em Libras',                'video',            31),
  ('recurso_local', 'comunicacao', 'sinalizacao_visual',      'Sinalização visual',                'bulb',             32),
  -- visual
  ('recurso_local', 'visual',      'cardapio_braille',        'Cardápio em Braille',               'braille',          40),
  ('recurso_local', 'visual',      'mapa_tatil',              'Mapa tátil',                        'map-2',            41),
  ('recurso_local', 'visual',      'audioguia',               'Audioguia',                         'headphones',       42),
  ('recurso_local', 'visual',      'cao_guia',                'Espaço para cão-guia',              'dog',              43),
  -- sensorial / cognitiva
  ('recurso_local', 'sensorial',   'sala_baixa_estimulacao',  'Sala de baixa estimulação',         'armchair',         50),
  ('recurso_local', 'sensorial',   'equipamentos_sensoriais', 'Equipamentos sensoriais',           'puzzle',           51),
  ('recurso_local', 'sensorial',   'reducao_ruidos',          'Redução de ruídos',                 'volume-off',       52),
  ('recurso_local', 'sensorial',   'iluminacao_adequada',     'Ambiente com boa iluminação',       'bulb',             53),
  ('recurso_local', 'sensorial',   'comunicacao_simples',     'Comunicação simples e objetiva',    'messages',         54),
  -- serviços e apoio
  ('recurso_local', 'apoio',       'atendimento_prioritario', 'Atendimento prioritário',           'user-check',       60),
  ('recurso_local', 'apoio',       'guia_especializado',      'Guia especializado',                'map-route',        61),
  ('recurso_local', 'apoio',       'acessivel_idosos',        'Estrutura para pessoas idosas',     'old',              62),
  ('recurso_local', 'apoio',       'wifi_gratuito',           'Wi-Fi gratuito',                    'wifi',             63);

-- -----------------------------------------------------------------------------
-- 4. paginas: novos campos da página do empreendimento
-- -----------------------------------------------------------------------------
alter table public.paginas
  add column subtitulo text,
  add column descricao_curta text check (char_length(descricao_curta) <= 200),
  add column slogan text,
  add column diferencial text,
  add column faixa_preco smallint check (faixa_preco between 1 and 4),
  add column tags text[] not null default '{}',
  add column tema text not null default 'plura'
    check (tema in ('plura', 'azul_claro', 'azul_escuro', 'verde', 'amarelo', 'rosa', 'branca', 'marrom', 'cinza')),
  add column cnpj text check (cnpj ~ '^[0-9]{14}$'),
  add column legado boolean not null default false,
  add column whatsapp text,
  add column video_apresentacao text,
  add column ponto_referencia text,
  add column como_chegar_carro text,
  add column como_chegar_transporte text,
  add column rota_acessivel text,
  -- horarios: {"seg":[{"abre":"11:00","fecha":"15:00"},...], "ter":[], ...} (até 2 turnos por dia)
  add column horarios jsonb not null default '{}',
  add column feriados text,
  add column requer_agendamento boolean not null default false,
  add column tempo_medio text,
  add column antecedencia text,
  add column destaques_acessibilidade text[] not null default '{}'
    check (cardinality(destaques_acessibilidade) <= 4),
  -- observacoes_recursos: {"rampa": "Rampa na entrada lateral", ...}
  add column observacoes_recursos jsonb not null default '{}',
  add column antes_de_ir text[] not null default '{}',
  add column antes_de_ir_observacoes text,
  -- seguranca: {"informacoes","requisitos","equipamentos","profissionais","procedimentos","contatos_emergencia"}
  add column seguranca jsonb not null default '{}',
  add column updated_at timestamptz not null default now();

-- As duas páginas já existentes ficam isentas do CNPJ
update public.paginas set legado = true;

-- A obrigatoriedade do CNPJ (paginas_cnpj_obrigatorio) só é ativada no deploy
-- da versão nova: ver 20260923_fase1b_regras_producao.sql
create unique index paginas_cnpj_unico on public.paginas (cnpj) where cnpj is not null;

-- legado só pode ser definido pela migration: usuários não conseguem se isentar
create or replace function internal.protege_colunas_paginas()
returns trigger language plpgsql security definer set search_path = public as $$
begin
  if tg_op = 'INSERT' then
    new.legado := false;
  else
    new.legado := old.legado;
    new.updated_at := now();
  end if;
  return new;
end;
$$;

create trigger trg_protege_colunas_paginas
  before insert or update on public.paginas
  for each row execute function internal.protege_colunas_paginas();

-- -----------------------------------------------------------------------------
-- 5. Galeria: fotos (até 15) e links (vídeos, reels, 360°, tour virtual)
-- -----------------------------------------------------------------------------
create table public.pagina_midias (
  id uuid primary key default gen_random_uuid(),
  pagina_id uuid not null references public.paginas(id) on delete cascade,
  tipo text not null check (tipo in ('foto', 'link')),
  url text not null,
  -- links: youtube | instagram | tiktok | facebook | outro
  plataforma text,
  -- links: video | reel | foto_360 | tour_virtual
  formato text check (formato in ('video', 'reel', 'foto_360', 'tour_virtual')),
  categoria text check (categoria in ('ambiente', 'entrada', 'banheiros', 'quartos', 'cardapio', 'equipe',
                                      'equipamentos', 'trilhas', 'piscina', 'area_externa', 'acessibilidade')),
  legenda text,
  texto_alt text,
  ordem int not null default 0,
  created_at timestamptz not null default now()
);
create index pagina_midias_pagina_idx on public.pagina_midias (pagina_id, ordem);

alter table public.pagina_midias enable row level security;
create policy pagina_midias_select_public on public.pagina_midias for select using (true);
create policy pagina_midias_insert_admin on public.pagina_midias for insert
  with check (internal.tem_vinculo(pagina_id, array['administrador'::papel_vinculo]));
create policy pagina_midias_update_admin on public.pagina_midias for update
  using (internal.tem_vinculo(pagina_id, array['administrador'::papel_vinculo]));
create policy pagina_midias_delete_admin on public.pagina_midias for delete
  using (internal.tem_vinculo(pagina_id, array['administrador'::papel_vinculo]));
grant select on public.pagina_midias to area04_backend;

create or replace function internal.limita_fotos_pagina()
returns trigger language plpgsql security definer set search_path = public as $$
begin
  if new.tipo = 'foto' and (select count(*) from pagina_midias where pagina_id = new.pagina_id and tipo = 'foto') >= 15 then
    raise exception 'Limite de 15 fotos por empreendimento atingido';
  end if;
  return new;
end;
$$;

create trigger trg_limita_fotos_pagina
  before insert on public.pagina_midias
  for each row execute function internal.limita_fotos_pagina();

-- Copia as fotos atuais para a nova galeria
insert into public.pagina_midias (pagina_id, tipo, url, ordem)
select p.id, 'foto', f.url, f.ordem::int
from public.paginas p, unnest(p.fotos_urls) with ordinality as f(url, ordem);

-- -----------------------------------------------------------------------------
-- 6. Experiências turísticas
-- -----------------------------------------------------------------------------
create table public.experiencias (
  id uuid primary key default gen_random_uuid(),
  pagina_id uuid not null references public.paginas(id) on delete cascade,
  nome text not null,
  descricao text,
  imagem_url text,
  duracao text,
  preco_a_partir numeric(10, 2) check (preco_a_partir >= 0),
  local text,
  faixa_etaria text,
  nivel_dificuldade text check (nivel_dificuldade in ('todos', 'facil', 'moderado', 'dificil')),
  requer_acompanhamento boolean not null default false,
  equipamentos text,
  o_que_levar text,
  acessibilidades text[] not null default '{}',
  ordem int not null default 0,
  ativo boolean not null default true,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
create index experiencias_pagina_idx on public.experiencias (pagina_id, ordem);

alter table public.experiencias enable row level security;
create policy experiencias_select_public on public.experiencias for select using (true);
create policy experiencias_insert_admin on public.experiencias for insert
  with check (internal.tem_vinculo(pagina_id, array['administrador'::papel_vinculo]));
create policy experiencias_update_admin on public.experiencias for update
  using (internal.tem_vinculo(pagina_id, array['administrador'::papel_vinculo]));
create policy experiencias_delete_admin on public.experiencias for delete
  using (internal.tem_vinculo(pagina_id, array['administrador'::papel_vinculo]));
grant select on public.experiencias to area04_backend;

-- -----------------------------------------------------------------------------
-- 7. Denúncia / correção de informação ("Essa informação está incorreta?")
-- -----------------------------------------------------------------------------
create table public.denuncias_informacao (
  id uuid primary key default gen_random_uuid(),
  pagina_id uuid not null references public.paginas(id) on delete cascade,
  usuario_id uuid not null default auth.uid() references public.usuarios(id) on delete cascade,
  motivo text not null check (motivo in ('recurso_nao_existe', 'acessibilidade_diferente', 'horario_incorreto',
                                         'local_fechado', 'informacao_desatualizada', 'outro')),
  comentario text,
  status text not null default 'pendente' check (status in ('pendente', 'resolvida', 'descartada')),
  observacao_admin text,
  resolvida_em timestamptz,
  created_at timestamptz not null default now()
);
create index denuncias_informacao_status_idx on public.denuncias_informacao (status, created_at desc);

alter table public.denuncias_informacao enable row level security;
create policy denuncias_insert_own on public.denuncias_informacao for insert to authenticated
  with check (usuario_id = (select auth.uid()) and status = 'pendente');
create policy denuncias_select_own on public.denuncias_informacao for select to authenticated
  using (usuario_id = (select auth.uid()));
create policy area04_all_denuncias on public.denuncias_informacao for all to area04_backend using (true) with check (true);
grant select, update, delete on public.denuncias_informacao to area04_backend;

-- -----------------------------------------------------------------------------
-- 8. Moderação de comentários/avaliações
--    Estrutura da moderação. A regra "nasce pendente e só aparece depois de
--    aprovada" é ativada no deploy (20260923_fase1b_regras_producao.sql).
-- -----------------------------------------------------------------------------
alter table public.avaliacoes
  -- default 'aprovado' até o deploy: o site em produção ainda não tem moderação
  add column status text not null default 'aprovado' check (status in ('pendente', 'aprovado', 'reprovado')),
  add column moderado_em timestamptz,
  add column motivo_moderacao text;

update public.avaliacoes set status = 'aprovado', moderado_em = now();

create policy area04_update_avaliacoes on public.avaliacoes for update to area04_backend using (true) with check (true);
grant update (status, moderado_em, motivo_moderacao) on public.avaliacoes to area04_backend;

create or replace function internal.protege_colunas_avaliacoes()
returns trigger language plpgsql security definer set search_path = public as $$
begin
  -- A Área 04 (moderação) só altera os campos de moderação
  if current_user = 'area04_backend' then
    new.nota := old.nota;
    new.comentario := old.comentario;
    new.usuario_id := old.usuario_id;
    new.pagina_id := old.pagina_id;
    if new.status is distinct from old.status then
      new.moderado_em := now();
    end if;
    return new;
  end if;

  new.moderado_em := old.moderado_em;
  new.motivo_moderacao := old.motivo_moderacao;

  if auth.uid() = old.usuario_id then
    new.resposta := old.resposta;
    new.respondido_em := old.respondido_em;
    new.sinalizada := old.sinalizada;
    -- Editou o texto ou a nota: volta para a fila de moderação
    if new.comentario is distinct from old.comentario or new.nota is distinct from old.nota then
      new.status := 'pendente';
    else
      new.status := old.status;
    end if;
  else
    new.nota := old.nota;
    new.comentario := old.comentario;
    new.usuario_id := old.usuario_id;
    new.pagina_id := old.pagina_id;
    new.status := old.status;
    if new.resposta is distinct from old.resposta then
      new.respondido_em := now();
    end if;
  end if;
  return new;
end;
$$;

-- Autor público no formato "Mariana S." + avatar, só para avaliações aprovadas
create or replace function public.avaliacoes_publicas(p_pagina_id uuid)
returns table (
  id uuid,
  nota smallint,
  comentario text,
  created_at timestamptz,
  autor_nome text,
  autor_avatar_url text
)
language sql stable security definer set search_path = public as $$
  select
    a.id,
    a.nota,
    a.comentario,
    a.created_at,
    case
      when array_length(regexp_split_to_array(trim(coalesce(u.nome_social, u.nome)), '\s+'), 1) > 1
        then split_part(trim(coalesce(u.nome_social, u.nome)), ' ', 1) || ' ' ||
             upper(left((regexp_split_to_array(trim(coalesce(u.nome_social, u.nome)), '\s+'))[
               array_length(regexp_split_to_array(trim(coalesce(u.nome_social, u.nome)), '\s+'), 1)], 1)) || '.'
      else trim(coalesce(u.nome_social, u.nome))
    end,
    u.avatar_url
  from avaliacoes a
  join usuarios u on u.id = a.usuario_id
  where a.pagina_id = p_pagina_id and a.status = 'aprovado'
  order by a.created_at desc;
$$;

grant execute on function public.avaliacoes_publicas(uuid) to anon, authenticated;

-- -----------------------------------------------------------------------------
-- 9. Preferências de turismo do usuário (códigos de catalogo_itens)
-- -----------------------------------------------------------------------------
alter table public.usuarios
  add column preferencias_turismo text[] not null default '{}';
