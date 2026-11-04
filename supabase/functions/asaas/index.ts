// Asaas: extrato (o que caiu na conta) e repasse ao cliente por Pix.
// - "cron": o agendador do banco chama de hora em hora (só com a chave interna x-regua-token).
// - Ações do site (só administradores): testar, sincronizar, pagar, status.
// A chave da API do Asaas fica no cofre (segredos 'asaas') e só é lida aqui.
import { createClient } from 'npm:@supabase/supabase-js@2';

const CORS = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type, x-regua-token',
  'Access-Control-Allow-Methods': 'POST, OPTIONS',
};
const json = (b: unknown, status = 200) => new Response(JSON.stringify(b), { status, headers: { ...CORS, 'Content-Type': 'application/json' } });
const URL_SB = Deno.env.get('SUPABASE_URL')!;
const adm = createClient(URL_SB, Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!, { auth: { persistSession: false } });
const dig = (s: unknown) => String(s ?? '').replace(/\D/g, '');
// data de hoje em Manaus (UTC-4)
const hoje = () => new Date(Date.now() - 4 * 3600e3).toISOString().slice(0, 10);
const diasAtras = (n: number) => new Date(Date.now() - 4 * 3600e3 - n * 86400e3).toISOString().slice(0, 10);

async function chave(): Promise<string> {
  const { data } = await adm.from('segredos').select('valor').eq('nome', 'asaas').maybeSingle();
  return data?.valor || '';
}
async function asaas(key: string, method: string, path: string, body?: unknown) {
  const base = key.includes('_hmlg_') ? 'https://api-sandbox.asaas.com/v3' : 'https://api.asaas.com/v3';
  const r = await fetch(base + path, {
    method,
    headers: { 'access_token': key, 'Content-Type': 'application/json', 'User-Agent': 'RL-Advogados-BI-Queda-de-Energia' },
    body: body ? JSON.stringify(body) : undefined,
  });
  const txt = await r.text();
  let dados: any = null; try { dados = JSON.parse(txt); } catch { dados = { message: txt }; }
  return { ok: r.ok, status: r.status, dados };
}
const erroAsaas = (r: { status: number; dados: any }) =>
  (r.dados?.errors || []).map((e: any) => e.description).join(' ') || r.dados?.message || ('erro ' + r.status);

async function todosClientes() {
  const out: { id: string; data: any }[] = [];
  for (let de = 0; ; de += 1000) {
    const { data, error } = await adm.from('clientes').select('id,data').range(de, de + 999);
    if (error) throw error;
    out.push(...(data || []));
    if (!data || data.length < 1000) break;
  }
  return out;
}
async function gravarCliente(id: string, atual: any, mudar: Record<string, unknown>) {
  const data = { ...atual, ...mudar, atualizadoEm: new Date().toISOString() };
  const { error } = await adm.from('clientes').update({ data, atualizado_em: new Date().toISOString() }).eq('id', id);
  if (error) throw error;
}

// Lê o extrato e guarda as entradas (créditos). Liga sozinho quando a descrição traz o nº do processo ou o CPF.
async function sincronizar(key: string, dias = 45) {
  const ini = diasAtras(dias), fim = hoje();
  const creditos: any[] = [];
  for (let off = 0; off < 5000; off += 100) {
    const r = await asaas(key, 'GET', `/financialTransactions?startDate=${ini}&finishDate=${fim}&offset=${off}&limit=100`);
    if (!r.ok) throw new Error('Asaas recusou o extrato: ' + erroAsaas(r));
    const lista = r.dados?.data || [];
    // só entradas; cobranças pagas (boletos/Pix de cobrança de outras áreas) ficam de fora
    lista.forEach((t: any) => { if (Number(t.value) > 0 && !t.paymentId && !/^PAYMENT_/.test(String(t.type || ''))) creditos.push(t); });
    if (!r.dados?.hasMore) break;
  }
  if (!creditos.length) return { lidas: 0, novas: 0, ligadas: 0 };
  const ids = creditos.map((t) => String(t.id));
  const { data: ja } = await adm.from('asaas_mov').select('id').in('id', ids);
  const existe = new Set((ja || []).map((x: any) => x.id));
  const novas = creditos.filter((t) => !existe.has(String(t.id)));
  if (!novas.length) return { lidas: creditos.length, novas: 0, ligadas: 0 };

  const clientes = await todosClientes();
  let ligadas = 0;
  for (const t of novas) {
    const d = dig(t.description);
    let alvo: { id: string; data: any } | undefined, como = '';
    if (d.length >= 11) {
      alvo = clientes.find((c) => { const p = dig(c.data?.processo); return p.length >= 13 && d.includes(p.slice(0, 13)); });
      if (alvo) como = 'processo';
      else { alvo = clientes.find((c) => { const cpf = dig(c.data?.cpf); return cpf.length === 11 && d.includes(cpf); }); if (alvo) como = 'cpf'; }
    }
    // só liga sozinho se o cliente ainda não tem "caiu na conta"
    if (alvo && alvo.data?.recebimento) alvo = undefined;
    const linha: any = { id: String(t.id), data: String(t.date).slice(0, 10), valor: Number(t.value), tipo: t.type || null, descricao: t.description || null, status: 'novo' };
    if (alvo) {
      linha.status = 'vinculado'; linha.cliente_id = alvo.id; linha.como = como; linha.ligado_em = new Date().toISOString(); linha.ligado_por = 'automático';
      const pag = !alvo.data?.pagamento || alvo.data.pagamento === 'aguardando' ? 'alvara_expedido' : alvo.data.pagamento;
      await gravarCliente(alvo.id, alvo.data, { recebimento: { data: linha.data, valor: linha.valor, obs: 'Asaas', asaasId: linha.id }, pagamento: pag });
      alvo.data.recebimento = true;
      ligadas++;
    }
    const { error } = await adm.from('asaas_mov').insert(linha);
    if (error && !/duplicate/i.test(error.message)) throw error;
  }
  return { lidas: creditos.length, novas: novas.length, ligadas };
}

const FINAL = ['DONE', 'FAILED', 'CANCELLED'];
function aplicarStatus(rp: any, t: any) {
  return { ...rp, asaas: { ...rp.asaas, status: t.status, comprovante: t.transactionReceiptUrl || rp.asaas?.comprovante || null,
    favorecido: t.bankAccount?.ownerName || rp.asaas?.favorecido || null, motivo: t.failReason || null } };
}
async function gravarRepasse(c: { id: string; data: any }, rp: any) {
  const st = rp.asaas?.status;
  const mudar: Record<string, unknown> = { repasse: rp };
  if (st === 'DONE') { mudar.pagamento = 'pago'; mudar.arquivado = true; mudar.arquivadoEm = rp.data; }
  await gravarCliente(c.id, c.data, mudar);
}
// Atualiza os Pix de repasse que ainda estão em andamento
async function atualizarRepasses(key: string) {
  const clientes = (await todosClientes()).filter((c) => c.data?.repasse?.asaas?.id && !FINAL.includes(c.data.repasse.asaas.status));
  let mudou = 0;
  for (const c of clientes) {
    const r = await asaas(key, 'GET', '/transfers/' + c.data.repasse.asaas.id);
    if (!r.ok) continue;
    if (r.dados.status !== c.data.repasse.asaas.status || (r.dados.transactionReceiptUrl && !c.data.repasse.asaas.comprovante)) {
      await gravarRepasse(c, aplicarStatus(c.data.repasse, r.dados)); mudou++;
    }
  }
  return { emAndamento: clientes.length, atualizados: mudou };
}

const TIPOS: Record<string, string> = { cpf: 'CPF', cnpj: 'CNPJ', email: 'EMAIL', celular: 'PHONE', aleatoria: 'EVP' };

async function pagar(key: string, body: any, email: string) {
  const valor = Math.round(Number(body.valor) * 100) / 100;
  if (!(valor > 0)) throw new Error('Valor inválido.');
  const tipo = TIPOS[body.tipoChave];
  if (!tipo) throw new Error('Tipo de chave Pix inválido.');
  let chavePix = String(body.chave || '').trim();
  if (tipo === 'CPF' || tipo === 'CNPJ' || tipo === 'PHONE') chavePix = dig(chavePix);
  if (!chavePix) throw new Error('Informe a chave Pix.');
  const { data: c, error } = await adm.from('clientes').select('id,data').eq('id', String(body.clienteId || '')).maybeSingle();
  if (error) throw error;
  if (!c) throw new Error('Cliente não encontrado.');
  const ant = c.data?.repasse;
  if (ant?.data && !(ant.asaas && FINAL.slice(1).includes(ant.asaas.status))) throw new Error('Este cliente já tem repasse registrado. Desfaça o anterior antes de pagar de novo.');
  const r = await asaas(key, 'POST', '/transfers', {
    value: valor, operationType: 'PIX', pixAddressKey: chavePix, pixAddressKeyType: tipo,
    description: String(body.descricao || ('Repasse ' + (c.data?.nome || ''))).slice(0, 140), externalReference: c.id,
  });
  if (!r.ok) throw new Error('O Asaas não fez o Pix: ' + erroAsaas(r));
  const t = r.dados;
  const rp = aplicarStatus({
    data: hoje(), valor, forma: body.terceiroNome ? 'pix_terceiro' : 'pix_cliente', chavePix, tipoChave: body.tipoChave,
    terceiroNome: body.terceiroNome || '', terceiroCpf: body.terceiroCpf || '', terceiroParentesco: body.terceiroParentesco || '',
    pagoPor: email, asaas: { id: t.id },
  }, t);
  await gravarRepasse(c, rp);
  return { ok: true, status: t.status, favorecido: rp.asaas.favorecido, comprovante: rp.asaas.comprovante, autorizar: t.authorized === false };
}

Deno.serve(async (req) => {
  if (req.method === 'OPTIONS') return new Response('ok', { headers: CORS });
  try {
    const body = await req.json().catch(() => ({}));

    if (body.acao === 'cron') {
      const { data } = await adm.from('segredos').select('valor').eq('nome', 'regua_token').maybeSingle();
      if (!data?.valor || req.headers.get('x-regua-token') !== data.valor) return json({ erro: 'não autorizado' }, 401);
      const key = await chave(); if (!key) return json({ rodou: false, motivo: 'sem chave' });
      return json({ extrato: await sincronizar(key, 10), repasses: await atualizarRepasses(key) });
    }

    const publica = Deno.env.get('SUPABASE_ANON_KEY') || 'sb_publishable_0tH0slL5lOQ06uZadSb28A__DYpJs0r';
    const sb = createClient(URL_SB, publica, { global: { headers: { Authorization: req.headers.get('Authorization') || '' } } });
    const { data: funcao } = await sb.rpc('minha_funcao');
    if (funcao !== 'admin') return json({ erro: 'Só administradores podem usar o Asaas.' }, 403);
    const { data: eu } = await sb.auth.getUser();
    const key = await chave();
    if (!key) return json({ erro: 'A chave do Asaas ainda não foi cadastrada. Cadastre em Configurações › Integrações › Asaas.' }, 400);

    if (body.acao === 'testar') {
      const r = await asaas(key, 'GET', '/finance/balance');
      if (!r.ok) return json({ erro: 'O Asaas recusou a chave: ' + erroAsaas(r) }, 502);
      return json({ ok: true, saldo: r.dados?.balance ?? null, sandbox: key.includes('_hmlg_') });
    }
    if (body.acao === 'sincronizar') {
      const extrato = await sincronizar(key, Math.min(Math.max(Number(body.dias) || 45, 1), 365));
      const repasses = await atualizarRepasses(key);
      return json({ extrato, repasses });
    }
    if (body.acao === 'pagar') return json(await pagar(key, body, eu?.user?.email || ''));
    return json({ erro: 'ação desconhecida' }, 400);
  } catch (e) {
    return json({ erro: (e as Error).message || String(e) }, 500);
  }
});
