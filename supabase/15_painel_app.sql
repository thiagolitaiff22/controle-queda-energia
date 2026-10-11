-- Aplicativo do prospectador: painel com todos os clientes que ele indicou e a situação de cada um.
-- Só dados de andamento (sem CPF, RG, endereço, número do processo nem valores). Pode rodar de novo.

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
        'origem', c.data ->> 'origem'
      ) order by c.data ->> 'nome')
      from public.clientes c
      where c.data ->> 'responsavelId' = a.prosp_id), '[]'::jsonb)
  )
  from public.campo_acessos a
  where a.token = p_token and a.ativo and length(p_token) >= 20
$$;
revoke all on function public.campo_painel(text) from public;
grant execute on function public.campo_painel(text) to anon, authenticated;

select 'ok' as painel_app;
