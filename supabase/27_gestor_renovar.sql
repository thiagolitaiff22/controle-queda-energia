-- Aplicativo (gestor): quem são os clientes que já podem renovar (o número "Renovar" do Painel).
-- Mesma regra de campo_gestor_painel: faltou na audiência, ou 5 meses do protocolo; ainda sem contato,
-- não recusou e não entrou com outra ação depois. Pode rodar de novo.
create or replace function public.campo_gestor_renovar(p_token text)
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
      (c.prot and coalesce(c.d ->> 'contatadoRetorno', '') = '' and coalesce(c.d ->> 'naoRenovou', 'false') <> 'true'
        and ((c.faltou and c.aud is not null) or (c.protd is not null and (c.protd + interval '5 months')::date <= hoje))
        and not exists (select 1 from c o where o.id <> c.id and length(c.cpfd) = 11 and o.cpfd = c.cpfd and o.protd > c.protd)) as renovar
    from c
  )
  select coalesce(jsonb_agg(jsonb_build_object(
      'id', c2.id, 'nome', c2.d ->> 'nome', 'contato', c2.d ->> 'contato', 'prosp', p.data ->> 'nome',
      'faltou', c2.faltou, 'aud', c2.aud, 'protocolo', c2.protd,
      'liberou', case when c2.faltou and c2.aud is not null then c2.aud else (c2.protd + interval '5 months')::date end)
      order by c2.d ->> 'nome'), '[]'::jsonb)
  into r
  from c2 left join public.prospectadores p on p.id = c2.d ->> 'responsavelId'
  where c2.renovar;
  return r;
end $$;
revoke all on function public.campo_gestor_renovar(text) from public;
grant execute on function public.campo_gestor_renovar(text) to anon, authenticated;
select 'ok' as renovar;
