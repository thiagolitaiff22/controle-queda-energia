-- Aplicativo: painel do GESTOR (quem tem "gestor" no cadastro de prospectador).
-- 1) campo_gestor_painel: visão do escritório inteiro (números, próximas audiências, por prospectador, últimos cadastros).
-- 2) campo_painel: o gestor vê TODOS os clientes (com o nome do prospectador); os demais continuam vendo só os seus.
-- 3) campo_cadastrar: o gestor pode atribuir o cadastro a qualquer prospectador (ou a ele mesmo) com p_dados.atribuirA.
-- Nada de valores em dinheiro. Pode rodar de novo.

create or replace function public.campo_gestor_painel(p_token text)
returns jsonb language plpgsql stable security definer set search_path = public as $$
declare hoje date := (now() at time zone 'America/Manaus')::date; r jsonb;
begin
  if not public.campo_eh_gestor(p_token) then return null; end if;
  with c as (
    select x.id, x.data d,
      coalesce(trim(x.data ->> 'processo'), '') <> '' as prot,
      case when coalesce(x.data ->> 'audData', '') ~ '^\d{4}-\d{2}-\d{2}' then left(x.data ->> 'audData', 10)::date end as aud,
      case when coalesce(x.data ->> 'protocolo', '') ~ '^\d{4}-\d{2}-\d{2}' then left(x.data ->> 'protocolo', 10)::date end as protd,
      (coalesce(x.data ->> 'comparecimento', '') = 'faltou' or coalesce(x.data ->> 'resultado', '') = 'ausente') as faltou,
      regexp_replace(coalesce(x.data ->> 'cpf', ''), '\D', '', 'g') as cpfd
    from public.clientes x where coalesce(x.data ->> 'descartado', 'false') <> 'true'
  ), c2 as (
    select c.*,
      -- pode renovar: faltou, ou 5 meses do protocolo; sem contato ainda, não recusou e não entrou com outra ação depois
      (c.prot and coalesce(c.d ->> 'contatadoRetorno', '') = '' and coalesce(c.d ->> 'naoRenovou', 'false') <> 'true'
        and ((c.faltou and c.aud is not null) or (c.protd is not null and (c.protd + interval '5 months')::date <= hoje))
        and not exists (select 1 from c o where o.id <> c.id and length(c.cpfd) = 11 and o.cpfd = c.cpfd and o.protd > c.protd)) as renovar
    from c
  )
  select jsonb_build_object(
    'atualizado', now(),
    'total', (select count(*) from c2),
    'emCadastro', (select count(*) from c2 where not prot),
    'aguardando', (select count(*) from c2 where prot and aud is null),
    'marcadas', (select count(*) from c2 where aud >= hoje),
    'renovar', (select count(*) from c2 where renovar),
    'proximas', coalesce((select jsonb_agg(jsonb_build_object('id', c2.id, 'nome', c2.d ->> 'nome', 'data', c2.aud, 'hora', c2.d ->> 'audHora',
        'online', (c2.d ->> 'online') = 'true', 'prosp', p.data ->> 'nome') order by c2.aud, c2.d ->> 'audHora')
      from (select * from c2 where aud >= hoje order by aud, d ->> 'audHora' limit 20) c2
      left join public.prospectadores p on p.id = c2.d ->> 'responsavelId'), '[]'::jsonb),
    'recentes', coalesce((select jsonb_agg(jsonb_build_object('id', c2.id, 'nome', c2.d ->> 'nome', 'em', left(coalesce(c2.d ->> 'criadoEm', ''), 10),
        'prot', c2.prot, 'prosp', p.data ->> 'nome') order by c2.d ->> 'criadoEm' desc)
      from (select * from c2 where coalesce(d ->> 'criadoEm', '') <> '' order by d ->> 'criadoEm' desc limit 12) c2
      left join public.prospectadores p on p.id = c2.d ->> 'responsavelId'), '[]'::jsonb),
    'prospectadores', coalesce((select jsonb_agg(jsonb_build_object('id', p.id, 'nome', p.data ->> 'nome',
        'indicados', (select count(*) from c2 where c2.d ->> 'responsavelId' = p.id),
        'emCadastro', (select count(*) from c2 where c2.d ->> 'responsavelId' = p.id and not c2.prot),
        'protocolados', (select count(*) from c2 where c2.d ->> 'responsavelId' = p.id and c2.prot),
        'comAud', (select count(*) from c2 where c2.d ->> 'responsavelId' = p.id and c2.aud is not null),
        'aPagar', (select count(*) filter (where c2.prot and coalesce(c2.d ->> 'indicacaoPagaEm', '') = '')
                        + count(*) filter (where c2.d ->> 'pagamento' = 'pago' and coalesce(c2.d ->> 'indicacao2PagaEm', '') = '')
                   from c2 where c2.d ->> 'responsavelId' = p.id))
        order by p.data ->> 'nome')
      from public.prospectadores p where coalesce(p.data ->> 'ativo', 'true') <> 'false'), '[]'::jsonb)
  ) into r;
  return r;
end $$;
revoke all on function public.campo_gestor_painel(text) from public;
grant execute on function public.campo_gestor_painel(text) to anon, authenticated;

-- painel do aplicativo: o gestor vê todos os clientes (com o nome do prospectador)
create or replace function public.campo_painel(p_token text)
returns jsonb language sql stable security definer set search_path = public as $$
  select jsonb_build_object(
    'atualizado', now(),
    'gestor', g.eh,
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
        'resultado', case when c.data ->> 'resultado' in ('parcial', 'procedente', 'improcedente', 'extinto', 'ausente') then c.data ->> 'resultado' end,
        'comparecimento', c.data ->> 'comparecimento',
        'origem', c.data ->> 'origem',
        'faltaDocs', c.data -> 'faltaDocs',
        'temPasta', coalesce(c.data ->> 'pastaId', '') <> '',
        'prosp', case when g.eh then (select p.data ->> 'nome' from public.prospectadores p where p.id = c.data ->> 'responsavelId') end
      ) order by c.data ->> 'nome')
      from public.clientes c
      where coalesce(c.data ->> 'descartado', 'false') <> 'true'
        and (g.eh or (c.data ->> 'responsavelId' = a.prosp_id
        -- prospectador: fora os que estão aguardando resultado (audiência passou sem sentença, ou conclusos)
        and not (
          coalesce(c.data ->> 'resultado', '') not in ('parcial', 'procedente', 'improcedente', 'extinto', 'ausente')
          and coalesce(c.data ->> 'comparecimento', '') <> 'faltou'
          and (
            coalesce(c.data ->> 'resultado', '') = 'aguardando'
            or coalesce(c.data ->> 'concluso', '') = 'true'
            or (coalesce(c.data ->> 'audData', '') ~ '^\d{4}-\d{2}-\d{2}' and left(c.data ->> 'audData', 10)::date < (now() at time zone 'America/Manaus')::date)
          )
        )))), '[]'::jsonb)
  )
  from public.campo_acessos a, lateral (select public.campo_eh_gestor(p_token) as eh) g
  where a.token = p_token and a.ativo and length(p_token) >= 20
$$;
revoke all on function public.campo_painel(text) from public;
grant execute on function public.campo_painel(text) to anon, authenticated;

-- cadastro pelo celular: o gestor pode atribuir a outro prospectador (p_dados.atribuirA)
create or replace function public.campo_cadastrar(p_token text, p_envio text, p_dados jsonb)
returns text language plpgsql security definer set search_path = public as $$
declare pid text; cid text; falta jsonb; alvo text := nullif(trim(coalesce(p_dados ->> 'atribuirA', '')), ''); nota text := '';
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
  select coalesce(jsonb_agg(x), '[]'::jsonb) into falta
  from jsonb_array_elements_text(case when jsonb_typeof(p_dados -> 'faltam') = 'array' then p_dados -> 'faltam' else '[]'::jsonb end) x
  where x in ('procuracao', 'rg_frente', 'cpf', 'luz', 'cliente');
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
      'criadoEm', to_char(now() at time zone 'utc', 'YYYY-MM-DD"T"HH24:MI:SS"Z"'),
      'atualizadoEm', to_char(now() at time zone 'utc', 'YYYY-MM-DD"T"HH24:MI:SS"Z"'))))
  on conflict (id) do nothing;
  return cid;
end $$;
revoke all on function public.campo_cadastrar(text, text, jsonb) from public;
grant execute on function public.campo_cadastrar(text, text, jsonb) to anon, authenticated;

select 'ok' as gestor_painel;
