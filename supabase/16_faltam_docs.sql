-- Documentos que faltam: o cadastro do celular guarda o que não foi fotografado (faltaDocs),
-- o prospectador completa depois pelo aplicativo e o escritório acompanha no BI. Pode rodar de novo.
-- Chaves: procuracao, rg_frente, cpf, luz, cliente.

-- 1) cadastro pelo celular: grava também a lista do que faltou
create or replace function public.campo_cadastrar(p_token text, p_envio text, p_dados jsonb)
returns text language plpgsql security definer set search_path = public as $$
declare pid text; cid text; falta jsonb;
begin
  select prosp_id into pid from public.campo_acessos where token = p_token and ativo and length(p_token) >= 20;
  if pid is null then raise exception 'Link inválido ou cancelado.'; end if;
  if coalesce(p_envio, '') !~ '^[A-Za-z0-9_-]{8,64}$' then raise exception 'Envio inválido.'; end if;
  cid := 'campo-' || p_envio;
  select coalesce(jsonb_agg(x), '[]'::jsonb) into falta
  from jsonb_array_elements_text(case when jsonb_typeof(p_dados -> 'faltam') = 'array' then p_dados -> 'faltam' else '[]'::jsonb end) x
  where x in ('procuracao', 'rg_frente', 'cpf', 'luz', 'cliente');
  -- só campos de cadastro; nada de financeiro ou audiência
  insert into public.clientes (id, data) values (cid,
    jsonb_strip_nulls(jsonb_build_object(
      'nome', left(coalesce(nullif(trim(p_dados ->> 'nome'), ''), 'Cliente sem nome (conferir)'), 200),
      'cpf', left(p_dados ->> 'cpf', 20), 'rg', left(p_dados ->> 'rg', 40),
      'endereco', left(p_dados ->> 'endereco', 300), 'contato', left(p_dados ->> 'contato', 40),
      'nascimento', left(p_dados ->> 'nascimento', 20),
      'pastaUrl', left(p_dados ->> 'pastaUrl', 300), 'pastaId', left(p_dados ->> 'pastaId', 100),
      'campoDocs', p_dados -> 'docs', 'campoLocal', p_dados -> 'local', 'obs', left(p_dados ->> 'leitura', 2000),
      'faltaDocs', case when jsonb_array_length(falta) > 0 then falta end,
      'responsavelId', pid, 'origem', 'campo', 'conferirDados', true,
      'criadoEm', to_char(now() at time zone 'utc', 'YYYY-MM-DD"T"HH24:MI:SS"Z"'),
      'atualizadoEm', to_char(now() at time zone 'utc', 'YYYY-MM-DD"T"HH24:MI:SS"Z"'))))
  on conflict (id) do nothing;
  return cid;
end $$;
revoke all on function public.campo_cadastrar(text, text, jsonb) from public;
grant execute on function public.campo_cadastrar(text, text, jsonb) to anon, authenticated;

-- 2) script do Google: pasta de um cliente deste prospectador (para completar os documentos)
create or replace function public.campo_pasta_cliente(p_token text, p_cliente text)
returns jsonb language sql stable security definer set search_path = public as $$
  select jsonb_build_object('pastaId', c.data ->> 'pastaId', 'nome', c.data ->> 'nome')
  from public.campo_acessos a join public.clientes c on c.data ->> 'responsavelId' = a.prosp_id
  where a.token = p_token and a.ativo and length(p_token) >= 20 and c.id = p_cliente
$$;
revoke all on function public.campo_pasta_cliente(text, text) from public;
grant execute on function public.campo_pasta_cliente(text, text) to anon, authenticated;

-- 3) script do Google: o prospectador mandou os documentos que faltavam; tira da lista e avisa o escritório
create or replace function public.campo_completar(p_token text, p_cliente text, p_docs jsonb)
returns jsonb language plpgsql security definer set search_path = public as $$
declare pid text; atual jsonb; resta jsonb; enviados jsonb;
begin
  select prosp_id into pid from public.campo_acessos where token = p_token and ativo and length(p_token) >= 20;
  if pid is null then raise exception 'Acesso inválido.'; end if;
  select data into atual from public.clientes where id = p_cliente and data ->> 'responsavelId' = pid;
  if atual is null then raise exception 'Cliente não encontrado.'; end if;
  enviados := case when jsonb_typeof(p_docs) = 'array' then p_docs else '[]'::jsonb end;
  select coalesce(jsonb_agg(x), '[]'::jsonb) into resta
  from jsonb_array_elements_text(coalesce(atual -> 'faltaDocs', '[]'::jsonb)) x
  where not enviados ? x;
  update public.clientes set data = (data - 'faltaDocs')
    || case when jsonb_array_length(resta) > 0 then jsonb_build_object('faltaDocs', resta) else '{}'::jsonb end
    || jsonb_build_object('conferirDados', true, 'docsCompletadosEm', to_char(now() at time zone 'utc', 'YYYY-MM-DD"T"HH24:MI:SS"Z"'),
         'campoDocs', coalesce(data -> 'campoDocs', '[]'::jsonb) || enviados,
         'atualizadoEm', to_char(now() at time zone 'utc', 'YYYY-MM-DD"T"HH24:MI:SS"Z"'))
  where id = p_cliente;
  return resta;
end $$;
revoke all on function public.campo_completar(text, text, jsonb) from public;
grant execute on function public.campo_completar(text, text, jsonb) to anon, authenticated;

-- 4) painel do aplicativo: inclui o que falta de cada cliente
create or replace function public.campo_painel(p_token text)
returns jsonb language sql stable security definer set search_path = public as $$
  select jsonb_build_object(
    'atualizado', now(),
    'clientes', coalesce((
      select jsonb_agg(jsonb_build_object(
        'id', c.id,
        'nome', c.data ->> 'nome',
        'contato', c.data ->> 'contato',
        'cadastro', coalesce(nullif(c.data ->> 'dataCadastro', ''), left(c.data ->> 'criadoEm', 10)),
        'protocolo', c.data ->> 'protocolo',
        'protocolado', coalesce(trim(c.data ->> 'processo'), '') <> '',
        'audData', c.data ->> 'audData',
        'audHora', c.data ->> 'audHora',
        'online', (c.data ->> 'online') = 'true',
        'resultado', c.data ->> 'resultado',
        'comparecimento', c.data ->> 'comparecimento',
        'concluso', (c.data ->> 'concluso') = 'true',
        'embargos', c.data ->> 'embargos',
        'pagamento', c.data ->> 'pagamento',
        'arquivado', (c.data ->> 'arquivado') = 'true',
        'origem', c.data ->> 'origem',
        'faltaDocs', c.data -> 'faltaDocs',
        'temPasta', coalesce(c.data ->> 'pastaId', '') <> ''
      ) order by c.data ->> 'nome')
      from public.clientes c
      where c.data ->> 'responsavelId' = a.prosp_id), '[]'::jsonb)
  )
  from public.campo_acessos a
  where a.token = p_token and a.ativo and length(p_token) >= 20
$$;
revoke all on function public.campo_painel(text) from public;
grant execute on function public.campo_painel(text) to anon, authenticated;

select 'ok' as faltam_docs;
