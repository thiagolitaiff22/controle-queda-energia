-- Aplicativo do prospectador: entrada com CPF e senha.
-- Primeira vez (ou depois que o administrador zerar): senha 123456. Logo depois o aplicativo pede para a pessoa
-- criar a própria senha de 6 números (não pode ser 123456). Essa senha fica só como hash: nem o administrador vê.
-- O CPF do prospectador é cadastrado no BI (Prospectadores › Editar). 5 senhas erradas = bloqueio de 15 minutos.
-- Pode rodar de novo sem perder dados.

alter table public.campo_logins add column if not exists senha_propria boolean not null default false;

-- prospectador pelo CPF (só os que têm CPF cadastrado no BI)
create or replace function public.campo_prosp_do_cpf(p_cpf text)
returns text language sql stable security definer set search_path = public as $$
  select p.id from public.prospectadores p
  where length(regexp_replace(coalesce(p_cpf, ''), '\D', '', 'g')) = 11
    and regexp_replace(coalesce(p.data ->> 'cpf', ''), '\D', '', 'g') = regexp_replace(p_cpf, '\D', '', 'g')
    and coalesce(p.data ->> 'ativo', 'true') <> 'false'
  order by p.atualizado_em desc limit 1
$$;
revoke all on function public.campo_prosp_do_cpf(text) from public, anon, authenticated;

-- aplicativo: entra com CPF e senha. Devolve {token, trocar} ou {erro}.
create or replace function public.campo_entrar_cpf(p_cpf text, p_senha text)
returns jsonb language plpgsql security definer set search_path = public as $$
declare d text := regexp_replace(coalesce(p_cpf, ''), '\D', '', 'g'); pid text; l public.campo_logins; t text; ok boolean;
begin
  pid := public.campo_prosp_do_cpf(d);
  if pid is null then return jsonb_build_object('erro', 'CPF ou senha errados. Se for o primeiro acesso, peça ao escritório para cadastrar o seu CPF.'); end if;
  select * into l from public.campo_logins where prosp_id = pid;
  if l.usuario is null then
    insert into public.campo_logins (usuario, prosp_id, senha_hash, senha_propria, atualizado_por)
    values (d, pid, extensions.crypt('123456', extensions.gen_salt('bf')), false, 'primeiro acesso')
    on conflict (usuario) do nothing;
    select * into l from public.campo_logins where prosp_id = pid;
    if l.usuario is null then return jsonb_build_object('erro', 'Não foi possível entrar. Fale com o escritório.'); end if;
  end if;
  if not l.ativo then return jsonb_build_object('erro', 'Seu acesso está desligado. Fale com o escritório.'); end if;
  if l.bloqueado_ate is not null and l.bloqueado_ate > now() then
    return jsonb_build_object('erro', 'Muitas tentativas erradas. Espere 15 minutos ou fale com o escritório.');
  end if;
  -- antes de criar a própria senha, a senha é 123456
  ok := case when l.senha_propria then l.senha_hash = extensions.crypt(coalesce(p_senha, ''), l.senha_hash) else coalesce(p_senha, '') = '123456' end;
  if not ok then
    update public.campo_logins set erros = erros + 1,
      bloqueado_ate = case when erros + 1 >= 5 then now() + interval '15 minutes' else null end
    where prosp_id = pid;
    return jsonb_build_object('erro', 'CPF ou senha errados.');
  end if;
  update public.campo_logins set erros = 0, bloqueado_ate = null, usuario = d where prosp_id = pid;
  select token into t from public.campo_acessos where prosp_id = pid and ativo order by criado_em desc limit 1;
  if t is null then
    t := replace(replace(encode(extensions.gen_random_bytes(18), 'base64'), '+', '-'), '/', '_');
    insert into public.campo_acessos (token, prosp_id, criado_por) values (t, pid, 'login:' || d);
  end if;
  return jsonb_build_object('token', t, 'trocar', not l.senha_propria);
end $$;
revoke all on function public.campo_entrar_cpf(text, text) from public;
grant execute on function public.campo_entrar_cpf(text, text) to anon, authenticated;

-- aplicativo: o prospectador cria a própria senha (6 números, não pode ser 123456)
create or replace function public.campo_criar_senha(p_token text, p_senha text)
returns jsonb language plpgsql security definer set search_path = public as $$
declare pid text;
begin
  select prosp_id into pid from public.campo_acessos where token = p_token and ativo and length(p_token) >= 20;
  if pid is null then return jsonb_build_object('erro', 'Seu acesso mudou. Entre de novo.'); end if;
  if coalesce(p_senha, '') !~ '^\d{6}$' then return jsonb_build_object('erro', 'A senha precisa ter 6 números.'); end if;
  if p_senha = '123456' or p_senha ~ '^(\d)\1{5}$' or p_senha = '654321' then
    return jsonb_build_object('erro', 'Essa senha é fácil demais. Escolha outros 6 números.');
  end if;
  update public.campo_logins set senha_hash = extensions.crypt(p_senha, extensions.gen_salt('bf')), senha_propria = true,
    senha_ver = null, erros = 0, bloqueado_ate = null, atualizado_em = now(), atualizado_por = 'prospectador'
  where prosp_id = pid;
  if not found then return jsonb_build_object('erro', 'Entre de novo com o CPF e a senha 123456.'); end if;
  return jsonb_build_object('ok', true);
end $$;
revoke all on function public.campo_criar_senha(text, text) from public;
grant execute on function public.campo_criar_senha(text, text) to anon, authenticated;

-- administrador: zera a senha (volta a ser 123456 e o aplicativo pede uma nova no próximo acesso)
create or replace function public.campo_zerar_senha(p_prosp text)
returns void language plpgsql security definer set search_path = public as $$
begin
  if public.minha_funcao() is distinct from 'admin' then raise exception 'Só administradores.'; end if;
  update public.campo_logins set senha_hash = extensions.crypt('123456', extensions.gen_salt('bf')), senha_propria = false,
    senha_ver = null, ativo = true, erros = 0, bloqueado_ate = null, atualizado_em = now(), atualizado_por = lower(auth.jwt() ->> 'email')
  where prosp_id = p_prosp;
end $$;
revoke all on function public.campo_zerar_senha(text) from public, anon;
grant execute on function public.campo_zerar_senha(text) to authenticated;

-- administrador: situação do acesso (a senha nunca volta)
create or replace function public.campo_login_status(p_prosp text)
returns jsonb language sql stable security definer set search_path = public as $$
  select case when public.minha_funcao() = 'admin' then
    (select jsonb_build_object('usuario', usuario, 'senhaPropria', senha_propria, 'ativo', ativo, 'bloqueado', bloqueado_ate is not null and bloqueado_ate > now(), 'atualizado_em', atualizado_em)
     from public.campo_logins where prosp_id = p_prosp)
  end
$$;
revoke all on function public.campo_login_status(text) from public, anon;
grant execute on function public.campo_login_status(text) to authenticated;

-- as senhas antigas que o administrador via no BI deixam de ser guardadas
update public.campo_logins set senha_ver = null where senha_ver is not null;

select 'ok' as login_cpf;
