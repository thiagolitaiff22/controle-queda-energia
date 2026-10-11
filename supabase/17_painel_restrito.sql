-- Painel do aplicativo do prospectador: ele vê só até "Ganhou".
-- Não recebe pagamento/alvará (pago aparece como ganhou) e não recebe os clientes que estão aguardando resultado
-- (audiência já passou e ainda sem sentença, ou conclusos). Pode rodar de novo.

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
        -- resultado só quando já há sentença (o "aguardando" não vai)
        'resultado', case when c.data ->> 'resultado' in ('parcial', 'procedente', 'improcedente', 'extinto', 'ausente') then c.data ->> 'resultado' end,
        'comparecimento', c.data ->> 'comparecimento',
        'origem', c.data ->> 'origem',
        'faltaDocs', c.data -> 'faltaDocs',
        'temPasta', coalesce(c.data ->> 'pastaId', '') <> ''
      ) order by c.data ->> 'nome')
      from public.clientes c
      where c.data ->> 'responsavelId' = a.prosp_id
        -- fora: aguardando resultado (audiência passou sem sentença, ou conclusos para decisão)
        and not (
          coalesce(c.data ->> 'resultado', '') not in ('parcial', 'procedente', 'improcedente', 'extinto', 'ausente')
          and coalesce(c.data ->> 'comparecimento', '') <> 'faltou'
          and (
            coalesce(c.data ->> 'resultado', '') = 'aguardando'
            or (c.data ->> 'concluso') = 'true'
            or ((c.data ->> 'audData') ~ '^\d{4}-\d{2}-\d{2}' and left(c.data ->> 'audData', 10)::date < (now() at time zone 'America/Manaus')::date)
          )
        )), '[]'::jsonb)
  )
  from public.campo_acessos a
  where a.token = p_token and a.ativo and length(p_token) >= 20
$$;
revoke all on function public.campo_painel(text) from public;
grant execute on function public.campo_painel(text) to anon, authenticated;

select 'ok' as painel_restrito;
