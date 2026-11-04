-- Asaas: o extrato da conta entra no BI e cada valor é ligado ao cliente; o repasse sai por Pix pelo Asaas.
-- A chave da API fica no cofre (segredos 'asaas'); só a função "asaas" lê.

alter table public.segredos drop constraint if exists segredos_nome_check;
alter table public.segredos add constraint segredos_nome_check
  check (nome in ('liderhub', 'regua_token', 'regua_anon', 'datajud', 'claude', 'campo_script', 'asaas'));

-- Entradas do extrato do Asaas (só créditos)
create table if not exists public.asaas_mov (
  id          text primary key,              -- id da movimentação no Asaas
  data        date not null,
  valor       numeric(14,2) not null,
  tipo        text,
  descricao   text,
  status      text not null default 'novo' check (status in ('novo', 'vinculado', 'ignorado')),
  cliente_id  text references public.clientes(id) on delete set null,
  sugestoes   jsonb not null default '[]'::jsonb, -- clientes com valor parecido (só sugestão)
  como        text,                            -- como foi ligado: processo, cpf, manual
  criado_em   timestamptz not null default now(),
  ligado_em   timestamptz,
  ligado_por  text
);
create index if not exists asaas_mov_status on public.asaas_mov (status, data desc);
alter table public.asaas_mov enable row level security;
revoke all on public.asaas_mov from anon, authenticated;
grant select on public.asaas_mov to authenticated;
grant all on public.asaas_mov to service_role;
drop policy if exists asaas_admin_le on public.asaas_mov;
create policy asaas_admin_le on public.asaas_mov for select to authenticated using (public.minha_funcao() = 'admin');

do $$ begin
  if not exists (select 1 from pg_publication_tables where pubname = 'supabase_realtime' and schemaname = 'public' and tablename = 'asaas_mov') then
    alter publication supabase_realtime add table public.asaas_mov;
  end if;
end $$;

-- Liga uma entrada ao cliente: grava "caiu na conta" no cliente
create or replace function public.asaas_vincular(p_mov text, p_cliente text)
returns void language plpgsql security definer set search_path = public as $$
declare m public.asaas_mov;
begin
  if public.minha_funcao() is distinct from 'admin' then raise exception 'Só administradores.'; end if;
  select * into m from public.asaas_mov where id = p_mov;
  if not found then raise exception 'Entrada do Asaas não encontrada.'; end if;
  if m.cliente_id is not null and m.cliente_id <> p_cliente then
    update public.clientes set data = data - 'recebimento', atualizado_em = now()
     where id = m.cliente_id and data->'recebimento'->>'asaasId' = m.id;
  end if;
  update public.asaas_mov set status = 'vinculado', cliente_id = p_cliente, como = 'manual', ligado_em = now(), ligado_por = lower(auth.jwt() ->> 'email') where id = p_mov;
  update public.clientes set
    data = data || jsonb_build_object(
      'recebimento', jsonb_build_object('data', m.data, 'valor', m.valor, 'obs', 'Asaas', 'asaasId', m.id),
      'pagamento', case when coalesce(data->>'pagamento', '') in ('', 'aguardando') then 'alvara_expedido' else data->>'pagamento' end,
      'atualizadoEm', to_char(now() at time zone 'utc', 'YYYY-MM-DD"T"HH24:MI:SS"Z"')),
    atualizado_em = now()
  where id = p_cliente;
  if not found then raise exception 'Cliente não encontrado.'; end if;
end $$;

-- Marca uma entrada como "não é desta ação" (ou volta para identificar); desliga do cliente, se estava ligada
create or replace function public.asaas_ignorar(p_mov text, p_ignorar boolean)
returns void language plpgsql security definer set search_path = public as $$
declare m public.asaas_mov;
begin
  if public.minha_funcao() is distinct from 'admin' then raise exception 'Só administradores.'; end if;
  select * into m from public.asaas_mov where id = p_mov;
  if not found then raise exception 'Entrada do Asaas não encontrada.'; end if;
  if m.cliente_id is not null then
    update public.clientes set data = data - 'recebimento', atualizado_em = now()
     where id = m.cliente_id and data->'recebimento'->>'asaasId' = m.id and not (data ? 'repasse');
  end if;
  update public.asaas_mov set status = case when p_ignorar then 'ignorado' else 'novo' end, cliente_id = null, como = null, ligado_em = null, ligado_por = null where id = p_mov;
end $$;

revoke all on function public.asaas_vincular(text, text) from public, anon;
revoke all on function public.asaas_ignorar(text, boolean) from public, anon;
grant execute on function public.asaas_vincular(text, text) to authenticated;
grant execute on function public.asaas_ignorar(text, boolean) to authenticated;

-- Lê o extrato do Asaas de hora em hora (8h às 19h de Manaus) e atualiza os Pix de repasse
select cron.unschedule(jobid) from cron.job where jobname = 'asaas-extrato';
select cron.schedule('asaas-extrato', '5 12-23 * * *', $job$
  select net.http_post(
    url := 'https://etmknidodbmtpvbzgvhp.supabase.co/functions/v1/asaas',
    headers := jsonb_build_object('Content-Type', 'application/json', 'x-regua-token', (select valor from public.segredos where nome = 'regua_token')),
    body := '{"acao":"cron"}'::jsonb,
    timeout_milliseconds := 120000
  );
$job$);

select 'ok' as asaas;
