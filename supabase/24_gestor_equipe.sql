-- Aplicativo do gestor: aba Equipe. Lista os prospectadores e cadastra um novo.
-- Tipo: "usa o aplicativo" (precisa de CPF; entra com o CPF e a senha 123456) ou "só indicou" (avulso, não usa o app; CPF opcional).
-- Pode rodar de novo.

create or replace function public.campo_gestor_equipe(p_token text)
returns jsonb language plpgsql stable security definer set search_path = public as $$
begin
  if not public.campo_eh_gestor(p_token) then return null; end if;
  return coalesce((select jsonb_agg(jsonb_build_object(
      'id', p.id, 'nome', p.data ->> 'nome', 'cpf', p.data ->> 'cpf', 'telefone', p.data ->> 'telefone',
      'avulso', coalesce(p.data ->> 'avulso', 'false') = 'true', 'gestor', coalesce(p.data ->> 'gestor', 'false') = 'true',
      'indicados', (select count(*) from public.clientes c where c.data ->> 'responsavelId' = p.id and coalesce(c.data ->> 'descartado', 'false') <> 'true'),
      'entrou', exists (select 1 from public.campo_logins l where l.prosp_id = p.id and l.senha_propria))
    order by coalesce(p.data ->> 'avulso', 'false'), p.data ->> 'nome')
    from public.prospectadores p where coalesce(p.data ->> 'ativo', 'true') <> 'false'), '[]'::jsonb);
end $$;
revoke all on function public.campo_gestor_equipe(text) from public;
grant execute on function public.campo_gestor_equipe(text) to anon, authenticated;

create or replace function public.campo_gestor_novo_prosp(p_token text, p_nome text, p_cpf text, p_telefone text, p_avulso boolean)
returns jsonb language plpgsql security definer set search_path = public as $$
declare n text := regexp_replace(trim(coalesce(p_nome, '')), '\s+', ' ', 'g');
        d text := regexp_replace(coalesce(p_cpf, ''), '\D', '', 'g');
        cpf_fmt text; novo text; agora text := to_char(now() at time zone 'utc', 'YYYY-MM-DD"T"HH24:MI:SS.MS"Z"');
begin
  if not public.campo_eh_gestor(p_token) then return jsonb_build_object('erro', 'Só o gestor cadastra prospectadores.'); end if;
  if length(n) < 3 then return jsonb_build_object('erro', 'Digite o nome completo.'); end if;
  if d <> '' and length(d) <> 11 then return jsonb_build_object('erro', 'CPF incompleto.'); end if;
  if not coalesce(p_avulso, false) and d = '' then return jsonb_build_object('erro', 'Para usar o aplicativo precisa do CPF (é o login).'); end if;
  if d <> '' and exists (select 1 from public.prospectadores where regexp_replace(coalesce(data ->> 'cpf', ''), '\D', '', 'g') = d) then
    return jsonb_build_object('erro', 'Este CPF já é de outro prospectador.');
  end if;
  cpf_fmt := case when d <> '' then substr(d, 1, 3) || '.' || substr(d, 4, 3) || '.' || substr(d, 7, 3) || '-' || substr(d, 10, 2) else '' end;
  novo := 'p-' || left(regexp_replace(lower(translate(n, 'áàâãäéèêëíìîïóòôõöúùûüçÁÀÂÃÄÉÈÊËÍÌÎÏÓÒÔÕÖÚÙÛÜÇ', 'aaaaaeeeeiiiiooooouuuucAAAAAEEEEIIIIOOOOOUUUUC')), '[^a-z0-9]+', '-', 'g'), 30)
          || '-' || substr(md5(random()::text), 1, 5);
  insert into public.prospectadores (id, data) values (novo, jsonb_build_object(
    'nome', n, 'cpf', cpf_fmt, 'telefone', left(coalesce(p_telefone, ''), 30), 'regiao', '', 'palavrasEndereco', '[]'::jsonb,
    'ativo', true, 'avulso', coalesce(p_avulso, false), 'criadoEm', agora, 'atualizadoEm', agora, 'criadoPor', 'gestor (aplicativo)'));
  return jsonb_build_object('ok', true, 'id', novo, 'nome', n);
end $$;
revoke all on function public.campo_gestor_novo_prosp(text, text, text, text, boolean) from public;
grant execute on function public.campo_gestor_novo_prosp(text, text, text, text, boolean) to anon, authenticated;

select 'ok' as gestor_equipe;
