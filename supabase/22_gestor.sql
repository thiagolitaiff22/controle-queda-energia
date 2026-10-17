-- Aplicativo: modo GESTOR. Quem tem "gestor" marcado no cadastro de prospectador (BI › Prospectadores › Editar)
-- vê no aplicativo a aba Pagamentos: as indicações de todos os prospectadores e marca o que já pagou.
-- Cada indicação é paga em duas partes: no protocolo (indicacaoPagaEm) e quando sai (indicacao2PagaEm; sai = cliente recebeu).
-- Pode rodar de novo.

-- campo_quem passa a dizer se a pessoa é gestor
create or replace function public.campo_quem(p_token text)
returns jsonb language sql stable security definer set search_path = public as $$
  select jsonb_build_object(
    'prospId', a.prosp_id,
    'nome', coalesce(p.data ->> 'nome', ''),
    'gestor', coalesce(p.data ->> 'gestor', 'false') = 'true',
    'envioUrl', (select envio_url from public.campo_config where id = 1),
    'cadastros', coalesce((
      select jsonb_agg(jsonb_build_object(
        'nome', c.data ->> 'nome', 'em', c.data ->> 'criadoEm',
        'etapa', case when coalesce(c.data ->> 'processo', '') = '' then 'sem_protocolo'
                      when coalesce(c.data ->> 'audData', '') = '' then 'protocolado' else 'audiencia' end)
        order by c.data ->> 'criadoEm' desc)
      from (select * from public.clientes c2 where c2.data ->> 'responsavelId' = a.prosp_id and c2.data ->> 'origem' = 'campo'
            order by c2.data ->> 'criadoEm' desc limit 60) c), '[]'::jsonb)
  )
  from public.campo_acessos a left join public.prospectadores p on p.id = a.prosp_id
  where a.token = p_token and a.ativo and length(p_token) >= 20
$$;
revoke all on function public.campo_quem(text) from public;
grant execute on function public.campo_quem(text) to anon, authenticated;

create or replace function public.campo_eh_gestor(p_token text)
returns boolean language sql stable security definer set search_path = public as $$
  select exists (select 1 from public.campo_acessos a join public.prospectadores p on p.id = a.prosp_id
                 where a.token = p_token and a.ativo and length(p_token) >= 20 and coalesce(p.data ->> 'gestor', 'false') = 'true')
$$;
revoke all on function public.campo_eh_gestor(text) from public, anon, authenticated;

-- gestor: indicações protocoladas de cada prospectador (só o necessário para pagar)
create or replace function public.campo_gestor_dados(p_token text)
returns jsonb language plpgsql stable security definer set search_path = public as $$
begin
  if not public.campo_eh_gestor(p_token) then return null; end if;
  return coalesce((
    select jsonb_agg(jsonb_build_object('id', p.id, 'nome', p.data ->> 'nome', 'itens', coalesce((
      select jsonb_agg(jsonb_build_object(
        'id', c.id, 'nome', c.data ->> 'nome', 'processo', c.data ->> 'processo', 'protocolo', left(c.data ->> 'protocolo', 10),
        'saiu', coalesce(c.data ->> 'pagamento', '') = 'pago',
        'p1', nullif(c.data ->> 'indicacaoPagaEm', ''), 'p2', nullif(c.data ->> 'indicacao2PagaEm', ''))
        order by c.data ->> 'protocolo' desc)
      from public.clientes c
      where c.data ->> 'responsavelId' = p.id and coalesce(c.data ->> 'processo', '') <> ''), '[]'::jsonb))
      order by p.data ->> 'nome')
    from public.prospectadores p), '[]'::jsonb);
end $$;
revoke all on function public.campo_gestor_dados(text) from public;
grant execute on function public.campo_gestor_dados(text) to anon, authenticated;

-- gestor: marca ou desmarca uma parte (1 = protocolo, 2 = quando sai)
create or replace function public.campo_gestor_marcar(p_token text, p_cliente text, p_parte int, p_pago boolean)
returns jsonb language plpgsql security definer set search_path = public as $$
declare campo text := case p_parte when 1 then 'indicacaoPagaEm' when 2 then 'indicacao2PagaEm' end;
        hoje text := to_char((now() at time zone 'America/Manaus')::date, 'YYYY-MM-DD');
begin
  if not public.campo_eh_gestor(p_token) then return jsonb_build_object('erro', 'Só o gestor marca pagamentos.'); end if;
  if campo is null then return jsonb_build_object('erro', 'Parte inválida.'); end if;
  update public.clientes set data = data || jsonb_build_object(campo, case when p_pago then hoje else '' end,
      'atualizadoEm', to_char(now() at time zone 'utc', 'YYYY-MM-DD"T"HH24:MI:SS.MS"Z"'))
  where id = p_cliente and coalesce(data ->> 'processo', '') <> '' and coalesce(data ->> 'responsavelId', '') <> '';
  if not found then return jsonb_build_object('erro', 'Cliente não encontrado.'); end if;
  return jsonb_build_object('ok', true, 'em', case when p_pago then hoje end);
end $$;
revoke all on function public.campo_gestor_marcar(text, text, int, boolean) from public;
grant execute on function public.campo_gestor_marcar(text, text, int, boolean) to anon, authenticated;

select 'ok' as gestor;
