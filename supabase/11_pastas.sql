-- Pasta automática do cliente no Google Drive (CLIENTES › PENDENTES DE PROTOCOLO / PROTOCOLADOS / ARQUIVADOS).
-- Pode rodar de novo sem perder dados.

-- equipe: endereço do script do Google (o mesmo do cadastro pelo celular), para criar a pasta ao cadastrar
create or replace function public.campo_url_equipe()
returns text language sql stable security definer set search_path = public as $$
  select envio_url from public.campo_config where id = 1 and public.minha_funcao() is not null
$$;
revoke all on function public.campo_url_equipe() from public, anon;
grant execute on function public.campo_url_equipe() to authenticated;

-- script do Google: em que etapa está o cliente de cada pasta (só das pastas que ele mesmo informa)
create or replace function public.campo_pastas_status(p_ids text[])
returns jsonb language sql stable security definer set search_path = public as $$
  select coalesce(jsonb_object_agg(c.data ->> 'pastaId',
           case when coalesce(c.data ->> 'arquivado', 'false') = 'true' then 'arquivado'
                when coalesce(trim(c.data ->> 'processo'), '') <> '' then 'protocolado'
                else 'pendente' end), '{}'::jsonb)
  from public.clientes c
  where c.data ->> 'pastaId' = any(p_ids[1:1000])
$$;
revoke all on function public.campo_pastas_status(text[]) from public;
grant execute on function public.campo_pastas_status(text[]) to anon, authenticated;

select 'ok' as pastas;
