-- Etapa 8c: arquivos (R2, até 25 MB cada) e agendamento de vistoria nas
-- inscrições de certificação. O arquivo vai para o bucket pelo Worker
-- (Áreas 02/03); aqui ficam só os metadados em certificacao_respostas.valor:
--   arquivo  → {"itens":[{"chave","nome","tamanho","tipo","enviado_em"}]}
--   vistoria → {"itens":[{"data":"AAAA-MM-DD","periodo":"manha|tarde"}],
--               "contato":"...","observacoes":"...","confirmada":null}
-- Projeto: grupo01-useast2.

-- Confere se a resposta deste requisito pode ser alterada agora
create or replace function internal.requisito_editavel(p_inscricao_id uuid, p_requisito_id uuid)
returns public.certificacao_requisitos
language plpgsql
security definer
set search_path to 'public'
as $$
declare
  v_insc certificacao_inscricoes;
  v_req certificacao_requisitos;
  v_status text;
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
  select status into v_status from certificacao_respostas where inscricao_id = p_inscricao_id and requisito_id = p_requisito_id;
  if v_status in ('enviada', 'aprovada') then
    raise exception 'Este requisito já foi enviado ou aprovado' using errcode = '22023';
  end if;
  return v_req;
end;
$$;
revoke all on function internal.requisito_editavel(uuid, uuid) from public, anon;

-- Salvar resposta: agora também vistoria (arquivos têm funções próprias)
create or replace function public.salvar_resposta_certificacao(p_inscricao_id uuid, p_requisito_id uuid, p_valor jsonb)
returns public.certificacao_respostas
language plpgsql
security definer
set search_path to 'public'
as $$
declare
  v_req certificacao_requisitos;
  v_resp certificacao_respostas;
  v_texto text;
  v_campos jsonb;
  v_respostas jsonb;
  v_datas jsonb;
  v_item jsonb;
  v_data date;
  i integer;
begin
  v_req := internal.requisito_editavel(p_inscricao_id, p_requisito_id);

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
  elsif v_req.tipo = 'vistoria' then
    v_datas := coalesce(p_valor->'itens', '[]'::jsonb);
    if jsonb_typeof(v_datas) <> 'array' or jsonb_array_length(v_datas) > 3 then
      raise exception 'Proponha até 3 datas para a vistoria' using errcode = '22023';
    end if;
    v_respostas := '[]'::jsonb;
    for v_item in select * from jsonb_array_elements(v_datas) loop
      begin
        v_data := (v_item->>'data')::date;
      exception when others then
        raise exception 'Data da vistoria inválida' using errcode = '22023';
      end;
      if v_data is null or v_data <= current_date or v_data > current_date + 365 then
        raise exception 'As datas da vistoria precisam ser a partir de amanhã e em até 1 ano' using errcode = '22023';
      end if;
      if coalesce(v_item->>'periodo', '') not in ('manha', 'tarde') then
        raise exception 'Escolha manhã ou tarde para cada data' using errcode = '22023';
      end if;
      v_respostas := v_respostas || jsonb_build_object('data', v_data, 'periodo', v_item->>'periodo');
    end loop;
    if char_length(coalesce(p_valor->>'contato', '')) > 200 or char_length(coalesce(p_valor->>'observacoes', '')) > 2000 then
      raise exception 'Contato ou observações muito longos' using errcode = '22023';
    end if;
    p_valor := jsonb_build_object('itens', v_respostas, 'contato', trim(coalesce(p_valor->>'contato', '')),
      'observacoes', trim(coalesce(p_valor->>'observacoes', '')), 'confirmada', null);
  else
    raise exception 'Use o envio de arquivos para este requisito' using errcode = '22023';
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

-- Registra um arquivo já gravado no R2 (o Worker apaga o objeto se isto falhar)
create or replace function public.adicionar_arquivo_certificacao(p_inscricao_id uuid, p_requisito_id uuid, p_item jsonb)
returns public.certificacao_respostas
language plpgsql
security definer
set search_path to 'public'
as $$
declare
  v_req certificacao_requisitos;
  v_resp certificacao_respostas;
  v_itens jsonb;
  v_max integer;
  v_prefixo text := 'inscricoes/' || p_inscricao_id || '/' || p_requisito_id || '/';
begin
  v_req := internal.requisito_editavel(p_inscricao_id, p_requisito_id);
  if v_req.tipo <> 'arquivo' then raise exception 'Este requisito não recebe arquivos' using errcode = '22023'; end if;
  if left(coalesce(p_item->>'chave', ''), char_length(v_prefixo)) <> v_prefixo
     or coalesce((p_item->>'tamanho')::bigint, 0) <= 0 or (p_item->>'tamanho')::bigint > 25 * 1024 * 1024
     or char_length(coalesce(p_item->>'nome', '')) not between 1 and 200 then
    raise exception 'Arquivo inválido' using errcode = '22023';
  end if;
  v_max := least(greatest(coalesce((v_req.config->>'max_arquivos')::integer, 1), 1), 10);

  select * into v_resp from certificacao_respostas where inscricao_id = p_inscricao_id and requisito_id = p_requisito_id for update;
  v_itens := coalesce(v_resp.valor->'itens', '[]'::jsonb);
  if jsonb_array_length(v_itens) >= v_max then
    raise exception 'Limite de % arquivo(s) para este requisito. Remova um para enviar outro.', v_max using errcode = '22023';
  end if;
  v_itens := v_itens || jsonb_build_object(
    'chave', p_item->>'chave', 'nome', p_item->>'nome', 'tamanho', (p_item->>'tamanho')::bigint,
    'tipo', left(coalesce(p_item->>'tipo', ''), 100), 'enviado_em', now());

  insert into certificacao_respostas (inscricao_id, requisito_id, valor, status, atualizado_por, updated_at)
  values (p_inscricao_id, p_requisito_id, jsonb_build_object('itens', v_itens), 'rascunho', auth.uid(), now())
  on conflict (inscricao_id, requisito_id) do update
    set valor = excluded.valor, status = 'rascunho', atualizado_por = excluded.atualizado_por, updated_at = now()
  returning * into v_resp;
  update certificacao_inscricoes set updated_at = now() where id = p_inscricao_id;
  return v_resp;
end;
$$;
revoke all on function public.adicionar_arquivo_certificacao(uuid, uuid, jsonb) from public, anon;
grant execute on function public.adicionar_arquivo_certificacao(uuid, uuid, jsonb) to authenticated;

-- Tira um arquivo da resposta; devolve true se a chave existia (o Worker apaga do R2)
create or replace function public.remover_arquivo_certificacao(p_inscricao_id uuid, p_requisito_id uuid, p_chave text)
returns boolean
language plpgsql
security definer
set search_path to 'public'
as $$
declare
  v_resp certificacao_respostas;
  v_itens jsonb;
  v_novos jsonb;
begin
  perform internal.requisito_editavel(p_inscricao_id, p_requisito_id);
  select * into v_resp from certificacao_respostas where inscricao_id = p_inscricao_id and requisito_id = p_requisito_id for update;
  v_itens := coalesce(v_resp.valor->'itens', '[]'::jsonb);
  select coalesce(jsonb_agg(x), '[]'::jsonb) into v_novos from jsonb_array_elements(v_itens) x where x->>'chave' <> p_chave;
  if jsonb_array_length(v_novos) = jsonb_array_length(v_itens) then return false; end if;
  update certificacao_respostas set valor = jsonb_build_object('itens', v_novos), status = 'rascunho', atualizado_por = auth.uid(), updated_at = now()
  where id = v_resp.id;
  return true;
end;
$$;
revoke all on function public.remover_arquivo_certificacao(uuid, uuid, text) from public, anon;
grant execute on function public.remover_arquivo_certificacao(uuid, uuid, text) to authenticated;
