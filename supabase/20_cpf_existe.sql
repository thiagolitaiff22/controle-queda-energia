-- Aplicativo do prospectador: antes de cadastrar, confere se o CPF já é cliente do escritório AINDA NO PRAZO.
-- Bloqueia quando o cliente está no Cadastro (sem protocolo) ou quando ainda não passaram 5 meses do protocolo
-- (mesma regra da aba Nova ação). Quem faltou na audiência já pode renovar na hora. Descartados não bloqueiam. Passado o prazo, a nova ação pode ser cadastrada.
-- Devolve só { bloqueado, liberaEm } (o prospectador não vê nome nem dados de outros clientes).
-- Rodar uma vez no Supabase: SQL Editor › colar este arquivo › Run.
create or replace function public.campo_cpf_cadastrado(p_token text, p_cpf text)
returns jsonb language plpgsql stable security definer set search_path = public as $$
declare d text := regexp_replace(coalesce(p_cpf, ''), '\D', '', 'g'); libera date; bloqueia boolean := false;
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
  return jsonb_build_object('bloqueado', coalesce(bloqueia, false), 'liberaEm', libera);
end $$;
revoke all on function public.campo_cpf_cadastrado(text, text) from public;
grant execute on function public.campo_cpf_cadastrado(text, text) to anon, authenticated;

select 'ok' as cpf_no_prazo;
