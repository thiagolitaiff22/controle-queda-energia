-- Renovação: quando o CPF já teve ação protocolada no escritório, o novo cadastro é RENOVAÇÃO.
-- Só o talão de luz atualizado é cobrado (os outros documentos estão na pasta da ação anterior).
-- 1) campo_cpf_cadastrado devolve também { renovacao } para o aplicativo avisar o prospectador.
-- 2) campo_cadastrar grava renovacao = true e acaoAnteriorId, e só deixa "luz" como documento pendente.
-- Pode rodar de novo.

create or replace function public.campo_cpf_cadastrado(p_token text, p_cpf text)
returns jsonb language plpgsql stable security definer set search_path = public as $$
declare d text := regexp_replace(coalesce(p_cpf, ''), '\D', '', 'g'); libera date; bloqueia boolean := false; renov boolean := false;
begin
  if not exists (select 1 from public.campo_acessos a where a.token = p_token and a.ativo and length(p_token) >= 20) then return null; end if;
  if length(d) <> 11 then return jsonb_build_object('bloqueado', false); end if;
  select bool_or(case
           when coalesce(c.data ->> 'processo', '') = '' then true                                   -- ainda no Cadastro
           when coalesce(c.data ->> 'comparecimento', '') = 'faltou' or coalesce(c.data ->> 'resultado', '') = 'ausente' then false   -- faltou na audiência: já pode renovar
           when coalesce(c.data ->> 'protocolo', '') !~ '^\d{4}-\d{2}-\d{2}' then true                -- processo sem data de protocolo
           else (left(c.data ->> 'protocolo', 10))::date + interval '5 months' > current_date end),
         max(case when coalesce(c.data ->> 'protocolo', '') ~ '^\d{4}-\d{2}-\d{2}' and coalesce(c.data ->> 'comparecimento', '') <> 'faltou' and coalesce(c.data ->> 'resultado', '') <> 'ausente' then ((left(c.data ->> 'protocolo', 10))::date + interval '5 months')::date end)
    into bloqueia, libera
  from public.clientes c
  where regexp_replace(coalesce(c.data ->> 'cpf', ''), '\D', '', 'g') = d
    and coalesce(c.data ->> 'descartado', 'false') <> 'true';
  select exists (select 1 from public.clientes c where regexp_replace(coalesce(c.data ->> 'cpf', ''), '\D', '', 'g') = d
                   and coalesce(c.data ->> 'descartado', 'false') <> 'true' and coalesce(trim(c.data ->> 'processo'), '') <> '') into renov;
  return jsonb_build_object('bloqueado', coalesce(bloqueia, false), 'liberaEm', libera, 'renovacao', renov);
end $$;
revoke all on function public.campo_cpf_cadastrado(text, text) from public;
grant execute on function public.campo_cpf_cadastrado(text, text) to anon, authenticated;

create or replace function public.campo_cadastrar(p_token text, p_envio text, p_dados jsonb)
returns text language plpgsql security definer set search_path = public as $$
declare pid text; cid text; falta jsonb; alvo text := nullif(trim(coalesce(p_dados ->> 'atribuirA', '')), ''); nota text := '';
        d text := regexp_replace(coalesce(p_dados ->> 'cpf', ''), '\D', '', 'g'); ant text;
begin
  select prosp_id into pid from public.campo_acessos where token = p_token and ativo and length(p_token) >= 20;
  if pid is null then raise exception 'Link inválido ou cancelado.'; end if;
  if coalesce(p_envio, '') !~ '^[A-Za-z0-9_-]{8,64}$' then raise exception 'Envio inválido.'; end if;
  if alvo is not null and alvo <> pid then
    if public.campo_eh_gestor(p_token) and exists (select 1 from public.prospectadores where id = alvo) then
      nota := 'Atribuído pelo gestor a ' || (select data ->> 'nome' from public.prospectadores where id = alvo) || '.' || chr(10);
      pid := alvo;
    end if;
  end if;
  cid := 'campo-' || p_envio;
  -- renovação: o mesmo CPF já teve ação protocolada no escritório (os documentos pessoais ficam na pasta da ação anterior)
  if length(d) = 11 then
    select c.id into ant from public.clientes c
    where c.id <> cid and regexp_replace(coalesce(c.data ->> 'cpf', ''), '\D', '', 'g') = d
      and coalesce(c.data ->> 'descartado', 'false') <> 'true' and coalesce(trim(c.data ->> 'processo'), '') <> ''
    order by c.data ->> 'protocolo' desc nulls last limit 1;
  end if;
  if ant is not null then nota := nota || 'Cliente de renovação: só o talão de luz atualizado é novo; os demais documentos estão na pasta da ação anterior.' || chr(10); end if;
  select coalesce(jsonb_agg(x), '[]'::jsonb) into falta
  from jsonb_array_elements_text(case when jsonb_typeof(p_dados -> 'faltam') = 'array' then p_dados -> 'faltam' else '[]'::jsonb end) x
  where x in ('procuracao', 'rg_frente', 'cpf', 'luz', 'cliente') and (ant is null or x = 'luz');
  insert into public.clientes (id, data) values (cid,
    jsonb_strip_nulls(jsonb_build_object(
      'nome', left(coalesce(nullif(trim(p_dados ->> 'nome'), ''), 'Cliente sem nome (conferir)'), 200),
      'cpf', left(p_dados ->> 'cpf', 20), 'rg', left(p_dados ->> 'rg', 40),
      'endereco', left(p_dados ->> 'endereco', 300), 'contato', left(p_dados ->> 'contato', 40),
      'nascimento', left(p_dados ->> 'nascimento', 20),
      'pastaUrl', left(p_dados ->> 'pastaUrl', 300), 'pastaId', left(p_dados ->> 'pastaId', 100),
      'campoDocs', p_dados -> 'docs', 'campoLocal', p_dados -> 'local', 'obs', left(nota || coalesce(p_dados ->> 'leitura', ''), 2000),
      'faltaDocs', case when jsonb_array_length(falta) > 0 then falta end,
      'fotoCliente', case when left(p_dados ->> 'foto', 23) = 'data:image/jpeg;base64,' and length(p_dados ->> 'foto') < 120000 then p_dados ->> 'foto' end,
      'responsavelId', pid, 'origem', 'campo', 'conferirDados', true,
      'renovacao', case when ant is not null then true end, 'acaoAnteriorId', ant,
      'criadoEm', to_char(now() at time zone 'utc', 'YYYY-MM-DD"T"HH24:MI:SS"Z"'),
      'atualizadoEm', to_char(now() at time zone 'utc', 'YYYY-MM-DD"T"HH24:MI:SS"Z"'))))
  on conflict (id) do nothing;
  return cid;
end $$;
revoke all on function public.campo_cadastrar(text, text, jsonb) from public;
grant execute on function public.campo_cadastrar(text, text, jsonb) to anon, authenticated;

select 'ok' as renovacao;
