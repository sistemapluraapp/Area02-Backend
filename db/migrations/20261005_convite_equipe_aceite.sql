-- Convite para equipe com aceite: o convidado entra como "pendente", sem
-- acesso, recebe notificação (e e-mail pelo backend) e aceita ou recusa.
-- Ao responder, quem convidou é notificado. Vínculos que já existiam ficam ativos.
-- Projeto: grupo01-useast2.

alter table public.vinculos
  add column if not exists status text not null default 'ativo',
  add column if not exists convidado_por uuid,
  add column if not exists convidado_em timestamptz,
  add column if not exists expira_em timestamptz;

do $$ begin
  if not exists (select 1 from pg_constraint where conname = 'vinculos_status_check') then
    alter table public.vinculos add constraint vinculos_status_check check (status in ('pendente', 'ativo'));
  end if;
end $$;

-- Só vínculos ativos dão acesso
create or replace function internal.tem_vinculo(p_pagina_id uuid, p_papeis papel_vinculo[] default array['administrador'::papel_vinculo, 'colaborador'::papel_vinculo])
returns boolean
language sql
security definer
set search_path to 'public'
as $$
  select exists (
    select 1 from vinculos v
    where v.pagina_id = p_pagina_id
      and v.papel = any(p_papeis)
      and v.status = 'ativo'
      and (v.usuario_id = auth.uid() or v.gov_conta_id = auth.uid())
  );
$$;

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
      and v.status = 'ativo'
      and (v.usuario_id = auth.uid() or v.gov_conta_id = auth.uid())
      and (v.papel = 'administrador' or p_aba = any(v.permissoes))
  );
$$;

-- Convite pendente só pode ser de colaborador; o próprio convidado não altera o vínculo
-- (aceitar e recusar passam por public.responder_convite_equipe)
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
  if v_uid is null or current_setting('plura.respondendo_convite', true) = 'sim' then
    return coalesce(new, old);
  end if;

  if tg_op = 'INSERT' then
    if new.papel = 'administrador'
       and exists (select 1 from vinculos where pagina_id = new.pagina_id and papel = 'administrador') then
      raise exception 'A página já tem um administrador';
    end if;
    if new.papel = 'administrador' then
      new.permissoes := '{}';
      new.status := 'ativo';
    end if;
    return new;
  end if;

  v_eh_admin := internal.tem_vinculo(coalesce(new.pagina_id, old.pagina_id), array['administrador'::papel_vinculo]);

  if tg_op = 'UPDATE' then
    if new.pagina_id <> old.pagina_id or new.papel <> old.papel
       or new.usuario_id is distinct from old.usuario_id
       or new.gov_conta_id is distinct from old.gov_conta_id
       or new.convidado_por is distinct from old.convidado_por then
      raise exception 'Só é possível alterar o cargo e as permissões';
    end if;
    if new.status = 'ativo' and old.status = 'pendente' then
      raise exception 'Só a pessoa convidada pode aceitar o convite';
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

  if old.papel = 'administrador' and exists (select 1 from paginas where id = old.pagina_id) then
    raise exception 'O administrador da página não pode ser removido';
  end if;
  return old;
end;
$$;

-- Equipe com situação do convite (substitui public.equipe_pagina, que fica só para versões antigas)
create or replace function public.equipe_da_pagina(p_pagina_id uuid)
returns table (
  id uuid, papel papel_vinculo, cargo text, permissoes text[], nome text, email text,
  tipo_conta text, conta_id uuid, created_at timestamptz, eh_voce boolean,
  status text, convidado_em timestamptz, expira_em timestamptz
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
         coalesce(v.usuario_id, v.gov_conta_id) = auth.uid(),
         v.status, v.convidado_em, v.expira_em
  from vinculos v
  left join usuarios us on us.id = v.usuario_id
  left join gov_contas g on g.id = v.gov_conta_id
  left join auth.users u on u.id = coalesce(v.usuario_id, v.gov_conta_id)
  where v.pagina_id = p_pagina_id
    and (internal.pode_editar(p_pagina_id, 'equipe') or coalesce(v.usuario_id, v.gov_conta_id) = auth.uid())
  order by (v.papel = 'administrador') desc, (v.status = 'ativo') desc, v.created_at;
$$;
revoke all on function public.equipe_da_pagina(uuid) from public, anon;
grant execute on function public.equipe_da_pagina(uuid) to authenticated;

-- Contagens por área: ativas e convites pendentes (para o login da Gov e o "Minhas páginas");
-- substitui public.minhas_areas
create or replace function public.minhas_areas_convites()
returns table (b2b integer, gov integer, eh_gov boolean, convites_b2b integer, convites_gov integer)
language sql
stable
security definer
set search_path to 'public'
as $$
  with meus as (
    select v.status, p.tipo, v.expira_em from vinculos v join paginas p on p.id = v.pagina_id
    where (v.usuario_id = auth.uid() or v.gov_conta_id = auth.uid()) and p.excluida_em is null
  )
  select
    (select count(*)::int from meus where status = 'ativo' and tipo = 'privada'),
    (select count(*)::int from meus where status = 'ativo' and tipo = 'publica'),
    exists (select 1 from gov_contas where id = auth.uid()),
    (select count(*)::int from meus where status = 'pendente' and tipo = 'privada' and expira_em > now()),
    (select count(*)::int from meus where status = 'pendente' and tipo = 'publica' and expira_em > now());
$$;
revoke all on function public.minhas_areas_convites() from public, anon;
grant execute on function public.minhas_areas_convites() to authenticated;

-- Convites pendentes da pessoa logada (para aceitar ou recusar)
create or replace function public.meus_convites_equipe()
returns table (
  id uuid, pagina_id uuid, pagina_nome text, pagina_tipo text, pagina_logo text, cargo text,
  permissoes text[], convidado_por_nome text, convidado_em timestamptz, expira_em timestamptz
)
language sql
stable
security definer
set search_path to 'public'
as $$
  select v.id, p.id, p.nome, p.tipo::text, p.logo_url, v.cargo, v.permissoes,
         coalesce(nullif(us.nome_social, ''), us.nome, g.nome, 'A equipe da página'),
         v.convidado_em, v.expira_em
  from vinculos v
  join paginas p on p.id = v.pagina_id and p.excluida_em is null
  left join usuarios us on us.id = v.convidado_por
  left join gov_contas g on g.id = v.convidado_por
  where v.status = 'pendente' and v.expira_em > now()
    and (v.usuario_id = auth.uid() or v.gov_conta_id = auth.uid())
  order by v.convidado_em desc;
$$;
revoke all on function public.meus_convites_equipe() from public, anon;
grant execute on function public.meus_convites_equipe() to authenticated;

-- Aceitar ou recusar: só o convidado, com o convite ainda válido.
-- Notifica quem convidou e registra no log da página.
create or replace function public.responder_convite_equipe(p_vinculo_id uuid, p_aceitar boolean)
returns table (pagina_id uuid, pagina_nome text, pagina_tipo text)
language plpgsql
security definer
set search_path to 'public'
as $$
declare
  v vinculos;
  v_pagina paginas;
  v_nome text;
begin
  select * into v from vinculos
  where id = p_vinculo_id and (usuario_id = auth.uid() or gov_conta_id = auth.uid());
  if v.id is null then raise exception 'Convite não encontrado'; end if;
  if v.status <> 'pendente' then raise exception 'Este convite já foi respondido'; end if;
  if v.expira_em <= now() then raise exception 'Este convite expirou. Peça um novo convite a quem convidou você.'; end if;

  select * into v_pagina from paginas where id = v.pagina_id;
  select coalesce(nullif(us.nome_social, ''), us.nome, g.nome) into v_nome
  from (select auth.uid() as id) x
  left join usuarios us on us.id = x.id
  left join gov_contas g on g.id = x.id;

  perform set_config('plura.respondendo_convite', 'sim', true);
  if p_aceitar then
    update vinculos set status = 'ativo', expira_em = null where id = v.id;
  else
    delete from vinculos where id = v.id;
  end if;
  perform set_config('plura.respondendo_convite', 'nao', true);

  if v.convidado_por is not null then
    insert into notificacoes (destinatario_id, tipo, titulo, corpo, entidade_tipo, entidade_id, metadata, enviar_email)
    values (
      v.convidado_por,
      case when p_aceitar then 'convite_equipe_aceito' else 'convite_equipe_recusado' end,
      case when p_aceitar then coalesce(v_nome, 'A pessoa convidada') || ' aceitou o convite'
           else coalesce(v_nome, 'A pessoa convidada') || ' recusou o convite' end,
      case when p_aceitar then coalesce(v_nome, 'A pessoa convidada') || ' agora faz parte da equipe de ' || v_pagina.nome || '.'
           else coalesce(v_nome, 'A pessoa convidada') || ' não aceitou o convite para a equipe de ' || v_pagina.nome || '.' end,
      'pagina', v_pagina.id,
      jsonb_build_object('pagina_nome', v_pagina.nome, 'pagina_tipo', v_pagina.tipo),
      true
    );
  end if;

  insert into pagina_logs (pagina_id, autor_id, autor_nome, acao)
  values (v_pagina.id, auth.uid(), v_nome, case when p_aceitar then 'Aceitou o convite para a equipe' else 'Recusou o convite para a equipe' end);

  return query select v_pagina.id, v_pagina.nome, v_pagina.tipo::text;
end;
$$;
revoke all on function public.responder_convite_equipe(uuid, boolean) from public, anon;
grant execute on function public.responder_convite_equipe(uuid, boolean) to authenticated;

-- Notificação para o convidado quando o convite é criado ou reenviado
create or replace function public.notificar_convite_equipe(p_vinculo_id uuid)
returns void
language plpgsql
security definer
set search_path to 'public'
as $$
declare
  v vinculos;
  v_pagina paginas;
  v_nome text;
begin
  select * into v from vinculos where id = p_vinculo_id and status = 'pendente';
  if v.id is null or not internal.pode_editar(v.pagina_id, 'equipe') then return; end if;
  select * into v_pagina from paginas where id = v.pagina_id;
  select coalesce(nullif(us.nome_social, ''), us.nome, g.nome) into v_nome
  from (select auth.uid() as id) x
  left join usuarios us on us.id = x.id
  left join gov_contas g on g.id = x.id;

  insert into notificacoes (destinatario_id, tipo, titulo, corpo, entidade_tipo, entidade_id, metadata, enviar_email)
  values (
    coalesce(v.usuario_id, v.gov_conta_id),
    'convite_equipe',
    'Convite para a equipe de ' || v_pagina.nome,
    coalesce(v_nome, 'A equipe da página') || ' convidou você para ajudar a editar ' || v_pagina.nome || '. Aceite ou recuse em Minhas páginas.',
    'convite_equipe', v.id,
    jsonb_build_object('pagina_id', v_pagina.id, 'pagina_nome', v_pagina.nome, 'pagina_tipo', v_pagina.tipo,
      'link', case when v_pagina.tipo = 'publica' then 'https://gov.plura.app.br/' else 'https://login.plura.app.br/' end),
    false
  );
end;
$$;
revoke all on function public.notificar_convite_equipe(uuid) from public, anon;
grant execute on function public.notificar_convite_equipe(uuid) to authenticated;
