-- Foto do cliente (miniatura tirada pelo prospectador) guardada no cadastro para aparecer no BI. Pode rodar de novo.

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
      'fotoCliente', case when left(p_dados ->> 'foto', 23) = 'data:image/jpeg;base64,' and length(p_dados ->> 'foto') < 120000 then p_dados ->> 'foto' end,
      'responsavelId', pid, 'origem', 'campo', 'conferirDados', true,
      'criadoEm', to_char(now() at time zone 'utc', 'YYYY-MM-DD"T"HH24:MI:SS"Z"'),
      'atualizadoEm', to_char(now() at time zone 'utc', 'YYYY-MM-DD"T"HH24:MI:SS"Z"'))))
  on conflict (id) do nothing;
  return cid;
end $$;
revoke all on function public.campo_cadastrar(text, text, jsonb) from public;
grant execute on function public.campo_cadastrar(text, text, jsonb) to anon, authenticated;

-- script do Google: grava a foto (miniatura) de um cliente pela pasta dele (usado na organização das pastas antigas)
create or replace function public.campo_foto_pasta(p_segredo text, p_pasta text, p_foto text)
returns integer language plpgsql security definer set search_path = public as $$
begin
  if not exists (select 1 from public.segredos s where s.nome = 'campo_script' and s.valor = p_segredo and length(p_segredo) >= 32) then
    raise exception 'Script não autorizado.';
  end if;
  if p_foto !~ '^data:image/(jpeg|png);base64,' or length(p_foto) > 200000 then return 0; end if;
  update public.clientes set data = data || jsonb_build_object('fotoCliente', p_foto) where data ->> 'pastaId' = p_pasta;
  return 1;
end $$;
revoke all on function public.campo_foto_pasta(text, text, text) from public;
grant execute on function public.campo_foto_pasta(text, text, text) to anon, authenticated;

select 'ok' as foto_cliente;
