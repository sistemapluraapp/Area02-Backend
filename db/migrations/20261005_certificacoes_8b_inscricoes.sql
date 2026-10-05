-- Etapa 8b: inscrição de páginas (B2B e Gov) nas certificações do ADM.
-- Inscrição → respostas por requisito. Escrita só pelas funções abaixo
-- (security definer), que checam a permissão da aba "selos" do editor.
-- Arquivos e vistoria entram na 8c; avaliação pelo ADM na 8d.
-- Projeto: grupo01-useast2.

create table if not exists public.certificacao_inscricoes (
  id uuid primary key default gen_random_uuid(),
  certificacao_id uuid not null references public.certificacoes(id) on delete restrict,
  pagina_id uuid not null references public.paginas(id) on delete cascade,
  -- em_andamento: preenchendo (ou corrigindo); enviada: aguardando o ADM;
  -- aprovada: certificação concedida; reprovada / cancelada: encerradas
  status text not null default 'em_andamento'
    check (status in ('em_andamento', 'enviada', 'aprovada', 'reprovada', 'cancelada')),
  criada_por uuid,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  enviada_em timestamptz,
  decidida_em timestamptz,
  concedida_em timestamptz,
  expira_em timestamptz,
  observacao_adm text
);
-- Uma inscrição viva por página e certificação
create unique index if not exists certificacao_inscricoes_viva_idx
  on public.certificacao_inscricoes (certificacao_id, pagina_id)
  where status in ('em_andamento', 'enviada', 'aprovada');
create index if not exists certificacao_inscricoes_pagina_idx on public.certificacao_inscricoes (pagina_id);

create table if not exists public.certificacao_respostas (
  id uuid primary key default gen_random_uuid(),
  inscricao_id uuid not null references public.certificacao_inscricoes(id) on delete cascade,
  requisito_id uuid not null references public.certificacao_requisitos(id) on delete restrict,
  valor jsonb not null default '{}'::jsonb,
  -- rascunho: salva e não enviada; enviada: com o ADM; aprovada; ajustes: ADM pediu correção
  status text not null default 'rascunho' check (status in ('rascunho', 'enviada', 'aprovada', 'ajustes')),
  comentario_adm text,
  atualizado_por uuid,
  updated_at timestamptz not null default now(),
  unique (inscricao_id, requisito_id)
);

alter table public.certificacao_inscricoes enable row level security;
alter table public.certificacao_respostas enable row level security;

do $$ begin
  if not exists (select 1 from pg_policy where polrelid = 'public.certificacao_inscricoes'::regclass and polname = 'inscricoes_select_equipe') then
    create policy inscricoes_select_equipe on public.certificacao_inscricoes for select to authenticated
      using (internal.tem_vinculo(pagina_id));
    create policy area04_all_inscricoes on public.certificacao_inscricoes for all to area04_backend using (true) with check (true);
    create policy respostas_select_equipe on public.certificacao_respostas for select to authenticated
      using (exists (select 1 from public.certificacao_inscricoes i where i.id = inscricao_id and internal.tem_vinculo(i.pagina_id)));
    create policy area04_all_respostas on public.certificacao_respostas for all to area04_backend using (true) with check (true);
  end if;
end $$;

grant select on public.certificacao_inscricoes, public.certificacao_respostas to authenticated;
grant select, insert, update, delete on public.certificacao_inscricoes, public.certificacao_respostas to area04_backend;

-- Etapas liberadas para preenchimento. A primeira sempre; uma etapa "paralela"
-- acompanha a anterior; uma "sequencial" só depois de todas as anteriores aprovadas
-- (todos os requisitos obrigatórios com resposta aprovada).
create or replace function internal.etapas_liberadas(p_inscricao_id uuid)
returns table (etapa_id uuid, aprovada boolean)
language plpgsql
stable
security definer
set search_path to 'public'
as $$
declare
  e record;
  v_primeira boolean := true;
  v_lib_anterior boolean := false;
  v_todas_aprovadas boolean := true;
  v_lib boolean;
  v_aprov boolean;
begin
  for e in
    select ce.id, ce.modo from certificacao_etapas ce
    join certificacao_inscricoes i on i.certificacao_id = ce.certificacao_id
    where i.id = p_inscricao_id
    order by ce.ordem, ce.id
  loop
    if v_primeira then v_lib := true;
    elsif e.modo = 'paralela' then v_lib := v_lib_anterior;
    else v_lib := v_todas_aprovadas;
    end if;
    select not exists (
      select 1 from certificacao_requisitos r
      left join certificacao_respostas rs on rs.requisito_id = r.id and rs.inscricao_id = p_inscricao_id
      where r.etapa_id = e.id and r.obrigatorio and coalesce(rs.status, '') <> 'aprovada'
    ) into v_aprov;
    if v_lib then
      etapa_id := e.id; aprovada := v_aprov; return next;
    end if;
    v_primeira := false;
    v_lib_anterior := v_lib;
    v_todas_aprovadas := v_todas_aprovadas and v_aprov;
  end loop;
end;
$$;
revoke all on function internal.etapas_liberadas(uuid) from public, anon;
grant execute on function internal.etapas_liberadas(uuid) to authenticated, area04_backend;

-- Leitura para o editor: etapas liberadas desta inscrição
create or replace function public.etapas_liberadas_inscricao(p_inscricao_id uuid)
returns table (etapa_id uuid, aprovada boolean)
language sql
stable
security definer
set search_path to 'public'
as $$
  select l.* from internal.etapas_liberadas(p_inscricao_id) l
  where exists (select 1 from certificacao_inscricoes i where i.id = p_inscricao_id and internal.tem_vinculo(i.pagina_id));
$$;
revoke all on function public.etapas_liberadas_inscricao(uuid) from public, anon;
grant execute on function public.etapas_liberadas_inscricao(uuid) to authenticated;

-- Inscreve a página (ou devolve a inscrição viva que já existe)
create or replace function public.inscrever_certificacao(p_certificacao_id uuid, p_pagina_id uuid)
returns public.certificacao_inscricoes
language plpgsql
security definer
set search_path to 'public'
as $$
declare
  v_cert certificacoes;
  v_pag paginas;
  v_insc certificacao_inscricoes;
begin
  if not internal.pode_editar(p_pagina_id, 'selos') then
    raise exception 'Você não tem acesso à aba "Selos e certificações" desta página' using errcode = '42501';
  end if;
  select * into v_pag from paginas where id = p_pagina_id and excluida_em is null;
  if v_pag.id is null then raise exception 'Página não encontrada' using errcode = 'P0002'; end if;
  select * into v_cert from certificacoes where id = p_certificacao_id and status = 'publicada';
  if v_cert.id is null then raise exception 'Certificação não encontrada ou não publicada' using errcode = 'P0002'; end if;

  if (v_pag.tipo = 'privada' and v_cert.escopo = 'b2g') or (v_pag.tipo = 'publica' and v_cert.escopo = 'b2b') then
    raise exception 'Esta certificação é só para %', case v_cert.escopo when 'b2b' then 'empresas (B2B)' else 'órgãos públicos (Gov)' end
      using errcode = '22023';
  end if;
  if upper(coalesce(v_pag.pais, 'BR')) <> upper(v_cert.pais)
     or (v_cert.uf is not null and upper(trim(coalesce(v_pag.uf, ''))) <> upper(trim(v_cert.uf)))
     or (v_cert.cidade is not null and lower(trim(coalesce(v_pag.cidade, ''))) <> lower(trim(v_cert.cidade))) then
    raise exception 'Esta certificação vale só para %. Confira a localização da página na aba Localização.',
      coalesce(v_cert.cidade || '/' || v_cert.uf, 'o estado ' || v_cert.uf, 'o país ' || v_cert.pais)
      using errcode = '22023';
  end if;

  select * into v_insc from certificacao_inscricoes
  where certificacao_id = p_certificacao_id and pagina_id = p_pagina_id and status in ('em_andamento', 'enviada', 'aprovada');
  if v_insc.id is not null then return v_insc; end if;

  insert into certificacao_inscricoes (certificacao_id, pagina_id, criada_por)
  values (p_certificacao_id, p_pagina_id, auth.uid())
  returning * into v_insc;
  perform public.registrar_log_pagina(p_pagina_id, 'Iniciou a inscrição na certificação ' || v_cert.titulo);
  return v_insc;
end;
$$;
revoke all on function public.inscrever_certificacao(uuid, uuid) from public, anon;
grant execute on function public.inscrever_certificacao(uuid, uuid) to authenticated;

-- Salva a resposta de um requisito (texto, link, vídeo ou formulário)
create or replace function public.salvar_resposta_certificacao(p_inscricao_id uuid, p_requisito_id uuid, p_valor jsonb)
returns public.certificacao_respostas
language plpgsql
security definer
set search_path to 'public'
as $$
declare
  v_insc certificacao_inscricoes;
  v_req certificacao_requisitos;
  v_resp certificacao_respostas;
  v_texto text;
  v_campos jsonb;
  v_respostas jsonb;
  i integer;
begin
  select * into v_insc from certificacao_inscricoes where id = p_inscricao_id;
  if v_insc.id is null or not internal.pode_editar(v_insc.pagina_id, 'selos') then
    raise exception 'Inscrição não encontrada' using errcode = 'P0002';
  end if;
  if v_insc.status <> 'em_andamento' then
    raise exception 'Esta inscrição não pode ser alterada agora (%)', v_insc.status using errcode = '22023';
  end if;
  select r.* into v_req from certificacao_requisitos r
  join certificacao_etapas e on e.id = r.etapa_id
  where r.id = p_requisito_id and e.certificacao_id = v_insc.certificacao_id;
  if v_req.id is null then raise exception 'Requisito não encontrado' using errcode = 'P0002'; end if;
  if not exists (select 1 from internal.etapas_liberadas(p_inscricao_id) l where l.etapa_id = v_req.etapa_id) then
    raise exception 'Esta etapa ainda não foi liberada' using errcode = '22023';
  end if;
  select * into v_resp from certificacao_respostas where inscricao_id = p_inscricao_id and requisito_id = p_requisito_id;
  if v_resp.status in ('enviada', 'aprovada') then
    raise exception 'Este requisito já foi enviado ou aprovado' using errcode = '22023';
  end if;

  if v_req.tipo = 'texto' then
    v_texto := trim(coalesce(p_valor->>'texto', ''));
    if char_length(v_texto) > 10000 then raise exception 'Texto muito longo (máximo de 10.000 caracteres)' using errcode = '22023'; end if;
    p_valor := jsonb_build_object('texto', v_texto);
  elsif v_req.tipo in ('link', 'video') then
    v_texto := trim(coalesce(p_valor->>'url', ''));
    if v_texto <> '' and (v_texto !~* '^https://[^\s]+$' or char_length(v_texto) > 1000) then
      raise exception 'Informe um endereço que comece com https://' using errcode = '22023';
    end if;
    p_valor := jsonb_build_object('url', v_texto);
  elsif v_req.tipo = 'formulario' then
    v_campos := coalesce(v_req.config->'campos', '[]'::jsonb);
    v_respostas := coalesce(p_valor->'respostas', '[]'::jsonb);
    if jsonb_typeof(v_respostas) <> 'array' or jsonb_array_length(v_respostas) > jsonb_array_length(v_campos) then
      raise exception 'Respostas do formulário inválidas' using errcode = '22023';
    end if;
    for i in 0 .. jsonb_array_length(v_respostas) - 1 loop
      if jsonb_typeof(v_respostas->i) not in ('string', 'null') or char_length(coalesce(v_respostas->>i, '')) > 5000 then
        raise exception 'Respostas do formulário inválidas' using errcode = '22023';
      end if;
    end loop;
    p_valor := jsonb_build_object('respostas', v_respostas);
  else
    raise exception 'Envio de arquivos e agendamento de vistoria chegam na próxima atualização' using errcode = '22023';
  end if;

  insert into certificacao_respostas (inscricao_id, requisito_id, valor, status, atualizado_por, updated_at)
  values (p_inscricao_id, p_requisito_id, p_valor, 'rascunho', auth.uid(), now())
  on conflict (inscricao_id, requisito_id) do update
    set valor = excluded.valor, status = 'rascunho', atualizado_por = excluded.atualizado_por, updated_at = now()
  returning * into v_resp;
  update certificacao_inscricoes set updated_at = now() where id = p_inscricao_id;
  return v_resp;
end;
$$;
revoke all on function public.salvar_resposta_certificacao(uuid, uuid, jsonb) from public, anon;
grant execute on function public.salvar_resposta_certificacao(uuid, uuid, jsonb) to authenticated;

-- Resposta preenchida de verdade (para conferir obrigatórios no envio)
create or replace function internal.resposta_preenchida(p_tipo text, p_config jsonb, p_valor jsonb)
returns boolean
language plpgsql
immutable
as $$
declare
  i integer;
  v_campos jsonb := coalesce(p_config->'campos', '[]'::jsonb);
begin
  if p_valor is null then return false; end if;
  if p_tipo = 'texto' then return coalesce(trim(p_valor->>'texto'), '') <> ''; end if;
  if p_tipo in ('link', 'video') then return coalesce(p_valor->>'url', '') <> ''; end if;
  if p_tipo = 'formulario' then
    for i in 0 .. jsonb_array_length(v_campos) - 1 loop
      if coalesce((v_campos->i->>'obrigatorio')::boolean, false)
         and coalesce(trim(p_valor->'respostas'->>i), '') = '' then
        return false;
      end if;
    end loop;
    return true;
  end if;
  -- arquivo e vistoria (8c): conta como preenchido quando houver itens
  return coalesce(jsonb_array_length(p_valor->'itens'), 0) > 0;
end;
$$;

-- Envia para análise do ADM tudo o que está liberado e ainda não foi enviado
create or replace function public.enviar_inscricao_certificacao(p_inscricao_id uuid)
returns public.certificacao_inscricoes
language plpgsql
security definer
set search_path to 'public'
as $$
declare
  v_insc certificacao_inscricoes;
  v_faltam text;
  v_titulo text;
begin
  select * into v_insc from certificacao_inscricoes where id = p_inscricao_id for update;
  if v_insc.id is null or not internal.pode_editar(v_insc.pagina_id, 'selos') then
    raise exception 'Inscrição não encontrada' using errcode = 'P0002';
  end if;
  if v_insc.status <> 'em_andamento' then
    raise exception 'Esta inscrição não pode ser enviada agora (%)', v_insc.status using errcode = '22023';
  end if;

  select string_agg(r.titulo, '; ' order by e.ordem, r.ordem) into v_faltam
  from internal.etapas_liberadas(p_inscricao_id) l
  join certificacao_etapas e on e.id = l.etapa_id
  join certificacao_requisitos r on r.etapa_id = e.id
  left join certificacao_respostas rs on rs.inscricao_id = p_inscricao_id and rs.requisito_id = r.id
  where not l.aprovada and r.obrigatorio
    and (rs.id is null or rs.status = 'ajustes' or not internal.resposta_preenchida(r.tipo, r.config, rs.valor));
  if v_faltam is not null then
    raise exception 'Preencha os requisitos obrigatórios: %', v_faltam using errcode = '22023';
  end if;

  update certificacao_respostas rs set status = 'enviada', updated_at = now()
  where rs.inscricao_id = p_inscricao_id and rs.status = 'rascunho'
    and exists (
      select 1 from certificacao_requisitos r join internal.etapas_liberadas(p_inscricao_id) l on l.etapa_id = r.etapa_id
      where r.id = rs.requisito_id);
  if not found then
    raise exception 'Não há nada novo para enviar' using errcode = '22023';
  end if;

  update certificacao_inscricoes set status = 'enviada', enviada_em = now(), updated_at = now()
  where id = p_inscricao_id returning * into v_insc;
  select titulo into v_titulo from certificacoes where id = v_insc.certificacao_id;
  perform public.registrar_log_pagina(v_insc.pagina_id, 'Enviou para análise a certificação ' || v_titulo);
  return v_insc;
end;
$$;
revoke all on function public.enviar_inscricao_certificacao(uuid) from public, anon;
grant execute on function public.enviar_inscricao_certificacao(uuid) to authenticated;

-- Desiste da inscrição (enquanto não aprovada)
create or replace function public.cancelar_inscricao_certificacao(p_inscricao_id uuid)
returns public.certificacao_inscricoes
language plpgsql
security definer
set search_path to 'public'
as $$
declare
  v_insc certificacao_inscricoes;
  v_titulo text;
begin
  select * into v_insc from certificacao_inscricoes where id = p_inscricao_id for update;
  if v_insc.id is null or not internal.pode_editar(v_insc.pagina_id, 'selos') then
    raise exception 'Inscrição não encontrada' using errcode = 'P0002';
  end if;
  if v_insc.status not in ('em_andamento', 'enviada') then
    raise exception 'Esta inscrição não pode ser cancelada' using errcode = '22023';
  end if;
  update certificacao_inscricoes set status = 'cancelada', decidida_em = now(), updated_at = now()
  where id = p_inscricao_id returning * into v_insc;
  select titulo into v_titulo from certificacoes where id = v_insc.certificacao_id;
  perform public.registrar_log_pagina(v_insc.pagina_id, 'Cancelou a inscrição na certificação ' || v_titulo);
  return v_insc;
end;
$$;
revoke all on function public.cancelar_inscricao_certificacao(uuid) from public, anon;
grant execute on function public.cancelar_inscricao_certificacao(uuid) to authenticated;
