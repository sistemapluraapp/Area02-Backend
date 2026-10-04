-- Etapa A: equipe da página (cargo + permissões por aba), logs e colaboradores
-- por e-mail (usuários Plura também podem colaborar em páginas Gov).
-- Projeto: grupo01-useast2.

-- 1. Cargo e permissões por aba do editor ---------------------------------
alter table public.vinculos
  add column if not exists cargo text,
  add column if not exists permissoes text[] not null default '{}';

do $$ begin
  if not exists (select 1 from pg_constraint where conname = 'vinculos_cargo_tamanho') then
    alter table public.vinculos add constraint vinculos_cargo_tamanho check (cargo is null or char_length(cargo) <= 80);
  end if;
  if not exists (select 1 from pg_constraint where conname = 'vinculos_permissoes_validas') then
    alter table public.vinculos add constraint vinculos_permissoes_validas check (
      permissoes <@ array['identidade','aparencia','acessibilidade','localizacao','horarios','galeria',
                          'experiencias','eventos','contato','antes','comentarios','selos','equipe']::text[]);
  end if;
end $$;

-- Administrador (dono) sempre pode tudo; colaborador só nas abas marcadas.
create or replace function internal.pode_editar(p_pagina_id uuid, p_aba text)
returns boolean
language sql
stable
security definer
set search_path to 'public'
as $$
  select exists (
    select 1 from vinculos v
    where v.pagina_id = p_pagina_id
      and (v.usuario_id = auth.uid() or v.gov_conta_id = auth.uid())
      and (v.papel = 'administrador' or p_aba = any(v.permissoes))
  );
$$;

-- 2. Proteções dos vínculos -------------------------------------------------
create or replace function internal.protege_vinculos()
returns trigger
language plpgsql
security definer
set search_path to 'public'
as $$
declare
  v_uid uuid := auth.uid();
  v_eh_admin boolean;
begin
  -- Rotinas internas (cron, ADM) não passam por estas regras
  if v_uid is null then
    return coalesce(new, old);
  end if;

  if tg_op = 'INSERT' then
    if new.papel = 'administrador'
       and exists (select 1 from vinculos where pagina_id = new.pagina_id and papel = 'administrador') then
      raise exception 'A página já tem um administrador';
    end if;
    if new.papel = 'administrador' then
      new.permissoes := '{}';
    end if;
    return new;
  end if;

  v_eh_admin := internal.tem_vinculo(coalesce(new.pagina_id, old.pagina_id), array['administrador'::papel_vinculo]);

  if tg_op = 'UPDATE' then
    if new.pagina_id <> old.pagina_id or new.papel <> old.papel
       or new.usuario_id is distinct from old.usuario_id
       or new.gov_conta_id is distinct from old.gov_conta_id then
      raise exception 'Só é possível alterar o cargo e as permissões';
    end if;
    if not v_eh_admin and (old.usuario_id = v_uid or old.gov_conta_id = v_uid) then
      raise exception 'Você não pode alterar as próprias permissões';
    end if;
    if not v_eh_admin and old.papel = 'administrador' then
      raise exception 'Só o administrador altera os próprios dados';
    end if;
    if old.papel = 'administrador' then
      new.permissoes := '{}';
    end if;
    return new;
  end if;

  -- DELETE: o administrador só sai junto com a página (cascade)
  if old.papel = 'administrador' and exists (select 1 from paginas where id = old.pagina_id) then
    raise exception 'O administrador da página não pode ser removido';
  end if;
  return old;
end;
$$;

create or replace trigger trg_protege_vinculos
  before insert or update or delete on public.vinculos
  for each row execute function internal.protege_vinculos();

-- Mover para a lixeira continua exclusivo do administrador, mesmo com o
-- update de páginas aberto para colaboradores.
create or replace function internal.protege_colunas_paginas()
returns trigger
language plpgsql
security definer
set search_path to 'public'
as $$
begin
  if tg_op = 'INSERT' then
    new.legado := false;
  else
    new.legado := old.legado;
    new.updated_at := now();
    if auth.uid() is not null then
      new.tipo := old.tipo;
      new.criado_por_usuario := old.criado_por_usuario;
      new.criado_por_gov_conta := old.criado_por_gov_conta;
      new.suspensa := old.suspensa;
      if new.excluida_em is distinct from old.excluida_em
         and not internal.tem_vinculo(old.id, array['administrador'::papel_vinculo]) then
        raise exception 'Só o administrador pode apagar ou restaurar a página';
      end if;
    end if;
  end if;
  return new;
end;
$$;

-- 3. RLS por aba (o vínculo do criador é inserido por trigger security definer)
alter policy paginas_update_admin on public.paginas
  using (internal.tem_vinculo(id))
  with check (internal.tem_vinculo(id));
alter policy pagina_midias_insert_admin on public.pagina_midias
  with check (internal.pode_editar(pagina_id, 'galeria'));
alter policy pagina_midias_update_admin on public.pagina_midias
  using (internal.pode_editar(pagina_id, 'galeria'));
alter policy pagina_midias_delete_admin on public.pagina_midias
  using (internal.pode_editar(pagina_id, 'galeria'));
alter policy experiencias_insert_admin on public.experiencias
  with check (internal.pode_editar(pagina_id, 'experiencias'));
alter policy experiencias_update_admin on public.experiencias
  using (internal.pode_editar(pagina_id, 'experiencias'));
alter policy experiencias_delete_admin on public.experiencias
  using (internal.pode_editar(pagina_id, 'experiencias'));
alter policy eventos_insert on public.eventos
  with check (internal.pode_editar(pagina_id, 'eventos'));
alter policy eventos_update on public.eventos
  using (internal.pode_editar(pagina_id, 'eventos'))
  with check (internal.pode_editar(pagina_id, 'eventos'));
alter policy eventos_delete on public.eventos
  using (internal.pode_editar(pagina_id, 'eventos'));
alter policy certificados_insert_admin on public.certificados
  with check (internal.pode_editar(pagina_id, 'selos'));
alter policy avaliacoes_update_own_or_pagina on public.avaliacoes
  using (usuario_id = (select auth.uid()) or internal.pode_editar(pagina_id, 'comentarios'));
alter policy vinculos_select_titular on public.vinculos
  using (usuario_id = (select auth.uid()) or gov_conta_id = (select auth.uid()) or internal.pode_editar(pagina_id, 'equipe'));
alter policy vinculos_insert_admin on public.vinculos
  with check (internal.pode_editar(pagina_id, 'equipe'));
alter policy vinculos_delete_admin on public.vinculos
  using (internal.pode_editar(pagina_id, 'equipe'));
do $$ begin
  if not exists (select 1 from pg_policy where polrelid = 'public.vinculos'::regclass and polname = 'vinculos_update_equipe') then
    create policy vinculos_update_equipe on public.vinculos for update
      using (internal.pode_editar(pagina_id, 'equipe')) with check (internal.pode_editar(pagina_id, 'equipe'));
  end if;
end $$;

-- Fotos (logo, capa, galeria, experiências, eventos): qualquer membro da
-- equipe; a aba exata é conferida no backend.
alter policy paginas_fotos_insert_admin on storage.objects
  with check (bucket_id = 'paginas-fotos' and exists (
    select 1 from public.vinculos v
    where v.pagina_id::text = (storage.foldername(objects.name))[1]
      and (v.usuario_id = auth.uid() or v.gov_conta_id = auth.uid())));
alter policy paginas_fotos_update_admin on storage.objects
  using (bucket_id = 'paginas-fotos' and exists (
    select 1 from public.vinculos v
    where v.pagina_id::text = (storage.foldername(objects.name))[1]
      and (v.usuario_id = auth.uid() or v.gov_conta_id = auth.uid())));
alter policy paginas_fotos_delete_admin on storage.objects
  using (bucket_id = 'paginas-fotos' and exists (
    select 1 from public.vinculos v
    where v.pagina_id::text = (storage.foldername(objects.name))[1]
      and (v.usuario_id = auth.uid() or v.gov_conta_id = auth.uid())));

-- 4. Busca de conta por e-mail (usuário Plura ou conta Gov) ------------------
create or replace function public.conta_por_email(p_email text)
returns table (id uuid, tipo text)
language sql
stable
security definer
set search_path to 'public', 'auth'
as $$
  select u.id,
         case when exists (select 1 from gov_contas g where g.id = u.id) then 'gov'
              when exists (select 1 from usuarios s where s.id = u.id) then 'usuario' end
  from auth.users u
  where lower(u.email) = lower(trim(p_email))
    and (exists (select 1 from gov_contas g where g.id = u.id) or exists (select 1 from usuarios s where s.id = u.id))
  limit 1;
$$;
revoke all on function public.conta_por_email(text) from public, anon;
grant execute on function public.conta_por_email(text) to authenticated;

-- 5. Equipe com nome, e-mail e permissões ------------------------------------
create or replace function public.equipe_pagina(p_pagina_id uuid)
returns table (
  id uuid, papel papel_vinculo, cargo text, permissoes text[], nome text, email text,
  tipo_conta text, conta_id uuid, created_at timestamptz, eh_voce boolean
)
language sql
stable
security definer
set search_path to 'public', 'auth'
as $$
  select v.id, v.papel, v.cargo, v.permissoes,
         coalesce(nullif(us.nome_social, ''), us.nome, g.nome, u.email::text),
         u.email::text,
         case when v.gov_conta_id is not null then 'gov' else 'usuario' end,
         coalesce(v.usuario_id, v.gov_conta_id),
         v.created_at,
         coalesce(v.usuario_id, v.gov_conta_id) = auth.uid()
  from vinculos v
  left join usuarios us on us.id = v.usuario_id
  left join gov_contas g on g.id = v.gov_conta_id
  left join auth.users u on u.id = coalesce(v.usuario_id, v.gov_conta_id)
  where v.pagina_id = p_pagina_id
    and (internal.pode_editar(p_pagina_id, 'equipe') or coalesce(v.usuario_id, v.gov_conta_id) = auth.uid())
  order by (v.papel = 'administrador') desc, v.created_at;
$$;
revoke all on function public.equipe_pagina(uuid) from public, anon;
grant execute on function public.equipe_pagina(uuid) to authenticated;

-- 6. Logs da página -----------------------------------------------------------
create table if not exists public.pagina_logs (
  id uuid primary key default gen_random_uuid(),
  pagina_id uuid not null references public.paginas(id) on delete cascade,
  autor_id uuid,
  autor_nome text,
  acao text not null check (char_length(acao) <= 300),
  criado_em timestamptz not null default now()
);
create index if not exists pagina_logs_pagina_idx on public.pagina_logs (pagina_id, criado_em desc);

alter table public.pagina_logs enable row level security;
do $$ begin
  if not exists (select 1 from pg_policy where polrelid = 'public.pagina_logs'::regclass and polname = 'pagina_logs_select_equipe') then
    create policy pagina_logs_select_equipe on public.pagina_logs for select to authenticated
      using (internal.pode_editar(pagina_id, 'equipe'));
    create policy area04_select_pagina_logs on public.pagina_logs for select to area04_backend using (true);
  end if;
end $$;
grant select on public.pagina_logs to authenticated, area04_backend;

-- Gravação só por esta função: o autor vem do token, não do corpo da requisição.
create or replace function public.registrar_log_pagina(p_pagina_id uuid, p_acao text)
returns void
language plpgsql
security definer
set search_path to 'public'
as $$
declare
  v_uid uuid := auth.uid();
  v_nome text;
begin
  if v_uid is null or not internal.tem_vinculo(p_pagina_id) then
    return;
  end if;
  select coalesce(nullif(us.nome_social, ''), us.nome, g.nome) into v_nome
  from (select v_uid as id) x
  left join usuarios us on us.id = x.id
  left join gov_contas g on g.id = x.id;
  insert into pagina_logs (pagina_id, autor_id, autor_nome, acao)
  values (p_pagina_id, v_uid, v_nome, left(p_acao, 300));
end;
$$;
revoke all on function public.registrar_log_pagina(uuid, text) from public, anon;
grant execute on function public.registrar_log_pagina(uuid, text) to authenticated;

-- 7. Usuário Plura pode entrar na Área Gov se colabora com página Gov ---------
create or replace function public.minhas_areas()
returns table (b2b integer, gov integer, eh_gov boolean)
language sql
stable
security definer
set search_path to 'public'
as $$
  select
    (select count(*)::int from vinculos v join paginas p on p.id = v.pagina_id
      where (v.usuario_id = auth.uid() or v.gov_conta_id = auth.uid()) and p.tipo = 'privada'),
    (select count(*)::int from vinculos v join paginas p on p.id = v.pagina_id
      where (v.usuario_id = auth.uid() or v.gov_conta_id = auth.uid()) and p.tipo = 'publica'),
    exists (select 1 from gov_contas where id = auth.uid());
$$;
revoke all on function public.minhas_areas() from public, anon;
grant execute on function public.minhas_areas() to authenticated;
