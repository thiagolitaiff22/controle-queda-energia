-- Aplicativo do prospectador: antes de cadastrar, confere se o CPF já está na base do escritório.
-- Devolve só verdadeiro/falso (o prospectador não vê nome nem dados de outros clientes).
-- Rodar uma vez no Supabase: SQL Editor › colar este arquivo › Run.
create or replace function public.campo_cpf_cadastrado(p_token text, p_cpf text)
returns boolean language sql stable security definer set search_path = public as $$
  select case
    when not exists (select 1 from public.campo_acessos a where a.token = p_token and a.ativo and length(p_token) >= 20) then null
    when length(regexp_replace(coalesce(p_cpf, ''), '\D', '', 'g')) <> 11 then false
    else exists (
      select 1 from public.clientes c
      where regexp_replace(coalesce(c.data ->> 'cpf', ''), '\D', '', 'g') = regexp_replace(p_cpf, '\D', '', 'g')
    )
  end
$$;
revoke all on function public.campo_cpf_cadastrado(text, text) from public;
grant execute on function public.campo_cpf_cadastrado(text, text) to anon, authenticated;

select 'ok' as cpf_existe;
