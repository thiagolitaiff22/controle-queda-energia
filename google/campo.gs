/**
 * Cadastro pelo celular do prospectador: recebe as fotos, cria a pasta do cliente no Drive,
 * lê a procuração e o RG com o Claude e cria o cliente no sistema (aba Clientes › Sem protocolo).
 *
 * Instalação (uma vez, na conta Google do escritório):
 *  1. script.google.com › Novo projeto › cole este arquivo inteiro.
 *  2. A chave do Claude se cola no sistema: Configurações › Integrações › Claude. O script lê de lá
 *     (com um código secreto que ele mesmo cria e registra no primeiro uso). Sem chave, as fotos vão
 *     para o Drive do mesmo jeito, mas o nome e o CPF ficam para o escritório preencher.
 *  3. Implantar › Nova implantação › Tipo: App da Web · Executar como: Eu · Quem pode acessar: Qualquer pessoa.
 *  4. Copie o endereço que termina em /exec e cole no sistema: Configurações › Cadastro pelo celular.
 *
 * Pastas (RODRIGUES LITAIFF ADVOGADOS › AMBAR ENERGIA › CLIENTES): o cliente novo entra em PENDENTES DE PROTOCOLO,
 * seja pelo celular ou pelo cadastro no BI. De hora em hora o script confere no sistema a etapa de cada cliente
 * e move a pasta para PROTOCOLADOS (tem número de processo) ou ARQUIVADOS (pago e arquivado).
 */
var SUPABASE_URL = 'https://etmknidodbmtpvbzgvhp.supabase.co';
var SUPABASE_KEY = 'sb_publishable_0tH0slL5lOQ06uZadSb28A__DYpJs0r'; // chave pública do site
var PASTA_CLIENTES = '1IqUpcNe7FCEdmVnfsLj0KP9k7K3Ck2dG'; // AMBAR ENERGIA › CLIENTES
var PENDENTES = 'PENDENTES DE PROTOCOLO', PROTOCOLADOS = 'PROTOCOLADOS', ARQUIVADOS = 'ARQUIVADOS';
var MODELO = 'claude-sonnet-5-5';
var MODELO_GPT = 'gpt-4o';   // ChatGPT: lê fotos e PDFs

var NOMES = {
  procuracao: 'Procuração', rg_frente: 'RG - frente', rg_verso: 'RG - verso', cpf: 'CPF',
  luz: 'Conta de luz', arogo: 'Documentos de quem assina a rogo', outro: 'Outro documento', cliente: 'Foto do cliente'
};

// o sistema usa esta resposta para mostrar Drive e Claude como ativados em Configurações
function doGet(){
  var g = 'ok'; try { gatilho(); } catch (x){ g = String(x && x.message || x); }
  var c = ''; try { c = chaveClaude(); } catch (x){}
  var ac = []; try { ac = ScriptApp.getProjectTriggers().map(function(t){ return t.getHandlerFunction(); }); } catch (x){ ac = ['erro: ' + x]; }
  return saida({ ok: true, servico: 'cadastro pelo celular', claude: !!c, acionadores: ac, gatilho: g });
}

/* chave do Claude: a do sistema (Configurações › Integrações › Claude); a das propriedades do script vale como reserva */
function chaveClaude(){
  var props = PropertiesService.getScriptProperties(), cache = CacheService.getScriptCache();
  var c = cache.get('claude'); if (c) return c;
  var seg = props.getProperty('SEGREDO_SISTEMA');
  if (!seg){ seg = Utilities.getUuid().replace(/-/g, '') + Utilities.getUuid().replace(/-/g, ''); props.setProperty('SEGREDO_SISTEMA', seg); }
  if (!props.getProperty('registrado')){
    if (rpc('campo_registrar_script', { p_segredo: seg }) !== true) throw new Error('Outro script já está registrado no sistema.');
    props.setProperty('registrado', '1');
  }
  c = rpc('campo_chave_claude', { p_segredo: seg }) || props.getProperty('ANTHROPIC_KEY') || '';
  if (c) cache.put('claude', c, 300);
  return c;
}

function doPost(e){
  try {
    // conferir os agendamentos é lento: no máximo uma vez por hora (o envio de cada arquivo fica rápido)
    var cg = CacheService.getScriptCache(); if (!cg.get('gatilho_ok')){ gatilho(); cg.put('gatilho_ok', '1', 3600); }
    var p = JSON.parse(e.postData.contents);
    if (p.acao === 'pasta') return saida(pastaDoCadastro(p));
    if (p.acao === 'lerPasta') return saida(lerPastaDoCadastro(p));
    var quem = validar(p.token);
    if (!/^[A-Za-z0-9_-]{8,64}$/.test(p.envio || '')) throw new Error('Envio inválido.');
    if (p.acao === 'arquivo') return saida(arquivo(p, quem));
    if (p.acao === 'fechar') return saida(fechar(p, quem));
    if (p.acao === 'completar') return saida(completar(p, quem));
    throw new Error('Ação desconhecida.');
  } catch (err){
    return saida({ ok: false, erro: String(err && err.message || err) });
  }
}

function saida(o){ return ContentService.createTextOutput(JSON.stringify(o)).setMimeType(ContentService.MimeType.JSON); }

function rpc(nome, args){
  var r = UrlFetchApp.fetch(SUPABASE_URL + '/rest/v1/rpc/' + nome, {
    method: 'post', contentType: 'application/json', muteHttpExceptions: true,
    headers: { apikey: SUPABASE_KEY }, payload: JSON.stringify(args)
  });
  var t = r.getContentText(), d = null; try { d = JSON.parse(t); } catch (x){}
  if (r.getResponseCode() >= 300) throw new Error((d && d.message) || t);
  return d;
}

function validar(token){
  var cache = CacheService.getScriptCache(), k = 'tk_' + String(token || '').slice(0, 40), c = cache.get(k);
  if (c) return JSON.parse(c);
  var q = rpc('campo_quem', { p_token: token });
  if (!q || !q.prospId) throw new Error('Link inválido ou cancelado. Peça um link novo ao escritório.');
  var quem = { prospId: q.prospId, nome: q.nome };
  cache.put(k, JSON.stringify(quem), 600);
  return quem;
}

// nome no sistema no mesmo padrão dos outros clientes: "Eliel dos Santos" (a pasta no Drive continua em maiúsculas)
function nomeProprio(s){
  return String(s || '').toLowerCase()
    .replace(/(^|[\s'-])([a-zà-ÿ])/g, function(m, a, b){ return a + b.toUpperCase(); })
    .replace(/\s(De|Da|Do|Dos|Das|E)(?=\s)/g, function(m){ return m.toLowerCase(); });
}
function nomeDigitado(p){ return String(p.cliente || '').replace(/[\\/:*?"<>|]/g, '').replace(/\s+/g, ' ').trim().toUpperCase().slice(0, 150); }
function pastaDoEnvio(envio, quem, cliente){
  var props = PropertiesService.getScriptProperties(), id = props.getProperty('pasta_' + envio);
  if (id){ try { return DriveApp.getFolderById(id); } catch (x){} }
  var lock = LockService.getScriptLock(); lock.waitLock(20000);
  try {
    id = props.getProperty('pasta_' + envio);
    if (id) return DriveApp.getFolderById(id);
    var nome = cliente || ('NOVO CADASTRO - ' + (quem.nome || 'prospectador') + ' - ' + Utilities.formatDate(new Date(), 'America/Manaus', 'dd-MM-yyyy HH.mm'));
    var f = subpasta(DriveApp.getFolderById(PASTA_CLIENTES), PENDENTES).createFolder(nome);
    props.setProperty('pasta_' + envio, f.getId());
    return f;
  } finally { lock.releaseLock(); }
}

function pastaDoCliente(p){
  var c = rpc('campo_pasta_cliente', { p_token: p.token, p_cliente: String(p.completar || '') });
  if (!c || !c.pastaId) throw new Error('Pasta do cliente não encontrada.');
  return DriveApp.getFolderById(c.pastaId);
}
function arquivo(p, quem){
  var pasta = p.completar ? pastaDoCliente(p) : pastaDoEnvio(p.envio, quem, nomeDigitado(p));
  var nome = String(p.nome || 'arquivo').replace(/[\\/:*?"<>|]/g, '').slice(0, 120);
  var sub = /\.pdf$/i.test(nome) || /^FOTO DO CLIENTE/i.test(nome) ? pasta : subpasta(pasta, 'Imagens escaneadas');
  var ja = sub.getFilesByName(nome);
  if (!ja.hasNext()) sub.createFile(Utilities.newBlob(Utilities.base64Decode(p.b64), p.mime || 'application/octet-stream', nome));
  return { ok: true };
}

function subpasta(pasta, nome){ var it = pasta.getFoldersByName(nome); return it.hasNext() ? it.next() : pasta.createFolder(nome); }

function fechar(p, quem){
  var digitado = nomeDigitado(p);
  var pasta = pastaDoEnvio(p.envio, quem, digitado);
  // o envio só registra o cliente (rápido); a IA lê os documentos depois, na leitura automática (a cada 10 minutos)
  var dados = { nome: '', cpf: '', rg: '', nascimento: '', endereco: '' }, nota = [];
  if (dados.cpf && !cpfValido(dados.cpf)){ nota.push('CPF lido (' + dados.cpf + ') não confere: verifique no documento.'); }
  if (dados.observacao) nota.push(dados.observacao);
  if (p.local && p.local.lat) nota.push('Localização da casa: https://maps.google.com/?q=' + p.local.lat + ',' + p.local.lng);
  var faltam = (p.faltam || []).map(function(k){ return NOMES[k] || k; });
  if (faltam.length) nota.push('Não foi fotografado: ' + faltam.join(', ') + '.');
  nota.unshift('Cadastrado pelo celular por ' + (quem.nome || 'prospectador') + '. Conferir os dados com os documentos.');

  // o nome digitado pelo prospectador vale; se a IA leu diferente nos documentos, avisa para conferir
  if (digitado && dados.nome && String(dados.nome).toUpperCase() !== digitado) nota.push('Nome nos documentos: ' + String(dados.nome).toUpperCase() + ' (o prospectador digitou ' + digitado + ').');
  if (digitado) dados.nome = digitado;
  if (dados.nome) pasta.setName(String(dados.nome).toUpperCase());
  dados.nome = nomeProprio(dados.nome);
  var id = rpc('campo_cadastrar', {
    p_token: p.token, p_envio: p.envio,
    p_dados: { nome: dados.nome, cpf: dados.cpf, rg: dados.rg, nascimento: dados.nascimento, endereco: dados.endereco,
      contato: p.contato || '', pastaUrl: pasta.getUrl(), pastaId: pasta.getId(), docs: p.docs || [], faltam: p.faltam || [], local: p.local || null, foto: /^data:image\/jpeg;base64,/.test(p.foto || '') ? p.foto : '', leitura: nota.join('\n') }
  });
  PropertiesService.getScriptProperties().deleteProperty('pasta_' + p.envio);
  return { ok: true, id: id, nome: dados.nome || '' };
}

/* Claude lê a procuração, o RG e o CPF (as imagens escaneadas) */
function lerDocumentos(pasta){
  var chave = chaveClaude();
  if (!chave) return null;
  var ordem = ['procuracao', 'rg_frente', 'rg_verso', 'cpf', 'luz'], imgs = [];   // os documentos a rogo são de outra pessoa: não entram na leitura
  var it = subpasta(pasta, 'Imagens escaneadas').getFiles(), todos = [];
  while (it.hasNext()) todos.push(it.next());
  ordem.forEach(function(k){
    todos.filter(function(f){ return f.getName().indexOf(NOMES[k]) === 0; }).slice(0, 2).forEach(function(f){
      if (imgs.length < 6) imgs.push({ k: NOMES[k], b: f.getBlob() });
    });
  });
  if (!imgs.length) return null;
  var conteudo = [];
  imgs.forEach(function(x){
    conteudo.push({ type: 'text', text: 'Documento: ' + x.k });
    conteudo.push({ type: 'image', source: { type: 'base64', media_type: x.b.getContentType() || 'image/jpeg', data: Utilities.base64Encode(x.b.getBytes()) } });
  });
  conteudo.push({ type: 'text', text:
    'Estas são fotos de documentos de um cliente de um escritório de advocacia (procuração, RG, CPF, conta de luz). ' +
    'Extraia os dados do OUTORGANTE (o cliente), nunca do advogado nem de quem assina a rogo pelo cliente. Responda só com um JSON, sem texto fora dele, no formato: ' +
    '{"nome":"","cpf":"000.000.000-00","rg":"","nascimento":"AAAA-MM-DD","endereco":"","observacao":""}. ' +
    'Nome completo em maiúsculas, como no documento. Endereço com rua, número, comunidade ou bairro e cidade. ' +
    'Deixe vazio o que não estiver legível; não invente. Em "observacao", avise em uma frase se houver divergência entre os documentos ou algo ilegível.' });
  var txt = perguntarIA(chave, conteudo, 800);
  var m = txt.match(/\{[\s\S]*\}/); if (!m) throw new Error('resposta sem dados');
  var o = JSON.parse(m[0]);
  return { nome: limpa(o.nome), cpf: limpa(o.cpf), rg: limpa(o.rg), nascimento: limpa(o.nascimento), endereco: limpa(o.endereco), observacao: limpa(o.observacao) };
}
/* pergunta à IA (ChatGPT ou Claude, pela chave cadastrada) e devolve o texto da resposta */
function perguntarIA(chave, conteudo, maxTokens){
  if (!/^sk-ant-/.test(chave)){
    var partes = conteudo.map(function(c){
      if (c.type === 'text') return { type: 'text', text: c.text };
      if (c.type === 'image') return { type: 'image_url', image_url: { url: 'data:' + c.source.media_type + ';base64,' + c.source.data } };
      return { type: 'file', file: { filename: 'documento.pdf', file_data: 'data:application/pdf;base64,' + c.source.data } };
    });
    var ro = UrlFetchApp.fetch('https://api.openai.com/v1/chat/completions', {
      method: 'post', contentType: 'application/json', muteHttpExceptions: true,
      headers: { Authorization: 'Bearer ' + chave },
      payload: JSON.stringify({ model: PropertiesService.getScriptProperties().getProperty('OPENAI_MODELO') || MODELO_GPT, max_tokens: maxTokens,
        response_format: { type: 'json_object' }, messages: [{ role: 'user', content: partes }] })
    });
    var dO = JSON.parse(ro.getContentText());
    if (ro.getResponseCode() >= 300) throw new Error('ChatGPT: ' + ((dO.error && dO.error.message) || ('erro ' + ro.getResponseCode())));
    return (dO.choices && dO.choices[0] && dO.choices[0].message && dO.choices[0].message.content) || '';
  }
  var r = UrlFetchApp.fetch('https://api.anthropic.com/v1/messages', {
    method: 'post', contentType: 'application/json', muteHttpExceptions: true,
    headers: { 'x-api-key': chave, 'anthropic-version': '2023-06-01' },
    payload: JSON.stringify({ model: MODELO, max_tokens: maxTokens, messages: [{ role: 'user', content: conteudo }] })
  });
  var d = JSON.parse(r.getContentText());
  if (r.getResponseCode() >= 300) throw new Error((d.error && d.error.message) || ('erro ' + r.getResponseCode()));
  return (d.content || []).map(function(c){ return c.text || ''; }).join('');
}
function limpa(t){ return String(t == null ? '' : t).trim().slice(0, 300); }

function cpfValido(c){
  c = String(c).replace(/\D/g, ''); if (c.length !== 11 || /^(\d)\1+$/.test(c)) return false;
  for (var t = 9; t < 11; t++){ var s = 0; for (var i = 0; i < t; i++) s += +c[i] * (t + 1 - i); if (((10 * s) % 11) % 10 !== +c[t]) return false; }
  return true;
}

/* de hora em hora: pastas de PENDENTES cujo cliente já foi protocolado vão para PROTOCOLADOS */
function gatilho(){
  var props = PropertiesService.getScriptProperties();
  // a IA só lê quando o escritório clica em "Ler documentos da pasta" no BI: desliga a leitura automática antiga
  ScriptApp.getProjectTriggers().forEach(function(t){ if (t.getHandlerFunction() === 'lerPendentes') ScriptApp.deleteTrigger(t); });
  if (props.getProperty('gatilho_ok')) return;
  if (!ScriptApp.getProjectTriggers().some(function(t){ return t.getHandlerFunction() === 'moverProtocolados'; }))
    ScriptApp.newTrigger('moverProtocolados').timeBased().everyHours(1).create();
  props.setProperty('gatilho_ok', '1');
}
function moverProtocolados(){
  var raiz = DriveApp.getFolderById(PASTA_CLIENTES);
  var destino = { pendente: subpasta(raiz, PENDENTES), protocolado: subpasta(raiz, PROTOCOLADOS), arquivado: subpasta(raiz, ARQUIVADOS) };
  var porId = {}, onde = {};
  ['pendente', 'protocolado'].forEach(function(k){
    var it = destino[k].getFolders();
    while (it.hasNext()){ var f = it.next(); porId[f.getId()] = f; onde[f.getId()] = k; }
  });
  var ids = Object.keys(porId); if (!ids.length) return 0;
  var etapa = rpc('campo_pastas_status', { p_ids: ids }) || {}, movidas = 0;
  Object.keys(etapa).forEach(function(id){
    var e = etapa[id];
    if (porId[id] && destino[e] && onde[id] !== e){ porId[id].moveTo(destino[e]); movidas++; }
  });
  return movidas;
}

/* pasta criada pelo BI no momento do cadastro: só para quem está logado no sistema e faz parte da equipe */
function pastaDoCadastro(p){
  var r = UrlFetchApp.fetch(SUPABASE_URL + '/rest/v1/rpc/minha_funcao', {
    method: 'post', contentType: 'application/json', muteHttpExceptions: true,
    headers: { apikey: SUPABASE_KEY, Authorization: 'Bearer ' + String(p.jwt || '') }, payload: '{}'
  });
  var funcao = null; try { funcao = JSON.parse(r.getContentText()); } catch (x){}
  if (r.getResponseCode() >= 300 || !funcao) throw new Error('Entre no sistema para criar a pasta.');
  if (p.pastaId){ try { var ja = DriveApp.getFolderById(p.pastaId); return { ok: true, id: ja.getId(), url: ja.getUrl() }; } catch (x){} }
  var nome = String(p.nome || '').trim().toUpperCase().replace(/[\\/:*?"<>|]/g, '').slice(0, 150);
  if (!nome) throw new Error('Informe o nome do cliente.');
  var raiz = DriveApp.getFolderById(PASTA_CLIENTES);
  var etapa = p.etapa === 'arquivado' ? ARQUIVADOS : p.etapa === 'protocolado' ? PROTOCOLADOS : PENDENTES;
  // evita pasta repetida: procura o mesmo nome nas três etapas antes de criar
  var achou = null;
  [PENDENTES, PROTOCOLADOS, ARQUIVADOS].some(function(n){ var it = subpasta(raiz, n).getFoldersByName(nome); if (it.hasNext()){ achou = it.next(); return true; } return false; });
  var f = achou || subpasta(raiz, etapa).createFolder(nome);
  return { ok: true, id: f.getId(), url: f.getUrl(), existente: !!achou };
}

/* ---------- IA lê os documentos que estiverem na pasta do cliente ---------- */
function equipeLogada(jwt){
  var r = UrlFetchApp.fetch(SUPABASE_URL + '/rest/v1/rpc/minha_funcao', {
    method: 'post', contentType: 'application/json', muteHttpExceptions: true,
    headers: { apikey: SUPABASE_KEY, Authorization: 'Bearer ' + String(jwt || '') }, payload: '{}'
  });
  var funcao = null; try { funcao = JSON.parse(r.getContentText()); } catch (x){}
  if (r.getResponseCode() >= 300 || !funcao) throw new Error('Entre no sistema para usar a pasta.');
}
// imagens e PDFs da pasta e das subpastas (até 8 arquivos e 18 MB, sem imagem acima de 4,5 MB)
function arquivosDaPasta(pasta){
  var lista = [];
  function junta(f){ var it = f.getFiles(); while (it.hasNext()){ var a = it.next(), t = a.getMimeType(); if (/^image\/(jpeg|png|webp|gif)$/.test(t) || t === 'application/pdf') lista.push(a); } }
  junta(pasta); var sub = pasta.getFolders(); while (sub.hasNext()) junta(sub.next());
  var peso = function(n){ n = n.toUpperCase(); return /PROCURA/.test(n) ? 0 : /RG|IDENTIDADE|CNH/.test(n) ? 1 : /CPF/.test(n) ? 2 : /LUZ|ENERGIA|CONTA|FATURA/.test(n) ? 3 : /COMPLETOS/.test(n) ? 9 : 5; };
  lista.sort(function(a, b){ return peso(a.getName()) - peso(b.getName()); });
  var escolhidos = [], total = 0;
  lista.forEach(function(a){
    var tam = a.getSize(), img = a.getMimeType() !== 'application/pdf';
    if (escolhidos.length >= 8 || (img && tam > 4.5e6) || total + tam > 18e6) return;
    escolhidos.push(a); total += tam;
  });
  return escolhidos;
}
function lerArquivos(arquivos){
  var chave = chaveClaude(); if (!chave) throw new Error('A chave da IA não está cadastrada (Configurações › Integrações › IA).');
  if (!arquivos.length) throw new Error('Nenhuma foto ou PDF na pasta.');
  var conteudo = [];
  arquivos.forEach(function(a, i){
    var b = a.getBlob(), pdf = a.getMimeType() === 'application/pdf';
    conteudo.push({ type: 'text', text: 'Arquivo ' + (i + 1) + ': ' + a.getName() });
    conteudo.push(pdf ? { type: 'document', source: { type: 'base64', media_type: 'application/pdf', data: Utilities.base64Encode(b.getBytes()) } }
                      : { type: 'image', source: { type: 'base64', media_type: a.getMimeType(), data: Utilities.base64Encode(b.getBytes()) } });
  });
  conteudo.push({ type: 'text', text:
    'Estes são documentos de um cliente de um escritório de advocacia (RG, CPF, CNH, conta de luz, procuração). ' +
    'Extraia os dados do cliente (o titular / outorgante), nunca do advogado nem de quem assina a rogo pelo cliente. Responda só com um JSON, sem texto fora dele, no formato: ' +
    '{"nome":"","cpf":"000.000.000-00","rg":"","nascimento":"AAAA-MM-DD","endereco":"","uc":"","observacao":"","tipos":[],"tem":{"procuracao":false,"rg":false,"cpf":false,"luz":false}}. ' +
    '"tem" diz quais documentos DO CLIENTE estão nos arquivos: "procuracao" (procuração assinada pelo cliente ou a rogo), "rg" (RG ou CNH do cliente), "cpf" (o número do CPF do cliente aparece em algum documento dele: cartão do CPF, RG novo ou CNH), "luz" (conta/talão de luz). Documentos de quem assina a rogo não contam. ' +
    '"tipos" é a lista com o tipo de cada arquivo, na mesma ordem (Arquivo 1, 2, ...): use "pessoais" para RG, CPF, CNH ou certidão do cliente; "arogo" para documentos (RG, CPF) de quem assina a rogo pelo cliente; "procuracao" para procuração; "residencia" para conta de luz ou outro comprovante de residência; "outro" para o resto. ' +
    'ATENÇÃO: quando o cliente não sabe assinar, outra pessoa assina a rogo por ele. Os documentos dessa pessoa (arquivos com "a rogo" no nome ou cujo nome não é o do outorgante da procuração) NUNCA são do cliente: não use o nome, CPF, RG ou data de nascimento deles. ' +
    'Nome completo em maiúsculas, como no documento. Endereço com rua, número, comunidade ou bairro e cidade (de preferência o da conta de luz). ' +
    '"uc" é o número da unidade consumidora (ou conta contrato / instalação) da conta de luz. ' +
    '"rg" no formato número com hífen antes do último dígito (ex.: 2960881-3); se não houver RG nos documentos, deixe vazio (o escritório usa o CPF). ' +
    'Deixe vazio o que não estiver legível; não invente. Em "observacao", avise em uma frase se houver divergência entre os documentos ou algo ilegível.' });
  var txt = perguntarIA(chave, conteudo, 900);
  var m = txt.match(/\{[\s\S]*\}/); if (!m) throw new Error('A IA não conseguiu ler os documentos.');
  var o = JSON.parse(m[0]);
  var out = { nome: limpa(o.nome), cpf: limpa(o.cpf), rg: limpa(o.rg), nascimento: limpa(o.nascimento), endereco: limpa(o.endereco), uc: limpa(o.uc), observacao: limpa(o.observacao) };
  var tem = o.tem || {}; out.tem = { procuracao: tem.procuracao === true, rg: tem.rg === true, cpf: tem.cpf === true, luz: tem.luz === true };
  try { renomearArquivos(arquivos, o.tipos || []); } catch (x){ console.log('renomear: ' + x); }
  if (out.cpf && !cpfValido(out.cpf)) out.observacao = ('CPF lido (' + out.cpf + ') não confere: verifique no documento. ' + out.observacao).trim();
  return out;
}
// botão "Ler documentos da pasta" no cadastro do BI
function lerPastaDoCadastro(p){
  equipeLogada(p.jwt);
  var pasta; try { pasta = DriveApp.getFolderById(String(p.pastaId || '')); } catch (x){ throw new Error('Pasta do cliente não encontrada no Drive.'); }
  var arq = arquivosDaPasta(pasta);
  return { ok: true, dados: lerArquivos(arq), arquivos: arq.length };
}
// automático: pastas em PENDENTES DE PROTOCOLO com arquivo novo desde a última leitura (até 4 por vez)
function lerPendentes(){
  var props = PropertiesService.getScriptProperties(), seg = props.getProperty('SEGREDO_SISTEMA');
  if (!seg || !chaveClaude()) return 0;
  var pend = subpasta(DriveApp.getFolderById(PASTA_CLIENTES), PENDENTES), it = pend.getFolders(), lidas = 0;
  while (it.hasNext() && lidas < 4){
    var f = it.next(), arq = arquivosDaPasta(f); if (!arq.length) continue;
    var ultimo = Math.max.apply(null, arq.map(function(a){ return a.getLastUpdated().getTime(); }));
    var k = 'lido_' + f.getId(); if (Number(props.getProperty(k) || 0) >= ultimo) continue;
    try { rpc('campo_preencher_pasta', { p_segredo: seg, p_pasta: f.getId(), p_dados: lerArquivos(arq) }); } catch (x){ console.log(f.getName() + ': ' + x); }
    props.setProperty(k, String(ultimo)); lidas++;
  }
  return lidas;
}

/* arquivos jogados na pasta ganham nome padrão pelo tipo: DOCUMENTOS PESSOAIS, PROCURAÇÃO, COMPROVANTE DE RESIDÊNCIA */
var NOME_TIPO = { pessoais: 'DOCUMENTOS PESSOAIS', procuracao: 'PROCURAÇÃO', residencia: 'COMPROVANTE DE RESIDÊNCIA', arogo: 'DOCUMENTOS A ROGO' };
function renomearArquivos(arquivos, tipos){
  var usados = {};
  arquivos.forEach(function(a){ usados[a.getName().toUpperCase()] = 1; });
  arquivos.forEach(function(a, i){
    var base = NOME_TIPO[String(tipos[i] || '').toLowerCase()]; if (!base) return;
    var nome = a.getName(), ext = (nome.match(/\.[A-Za-z0-9]{2,4}$/) || [''])[0].toLowerCase();
    if (nome.toUpperCase().indexOf(base) === 0) return; // já está com o nome padrão
    var novo = base + ext, n = 2;
    while (usados[novo.toUpperCase()]) novo = base + ' ' + (n++) + ext;
    delete usados[nome.toUpperCase()]; usados[novo.toUpperCase()] = 1;
    a.setName(novo);
  });
}

/* o prospectador completou os documentos que faltavam de um cliente já cadastrado */
function completar(p, quem){
  var resta = rpc('campo_completar', { p_token: p.token, p_cliente: String(p.completar || ''), p_docs: p.docs || [] });
  return { ok: true, restam: resta || [] };
}

/* ---------- organização das pastas que vieram do celular (cadastros antigos) ----------
 * Junta RG, CPF e talão de luz em DOCUMENTOS PESSOAIS.pdf; renomeia PROCURAÇÃO.pdf e FOTO DO CLIENTE.jpg;
 * os arquivos juntados vão para a lixeira do Drive (dá para recuperar). Rodar pelo editor: organizarExistentes.
 * Tudo síncrono (sem biblioteca): os PDFs do aplicativo são só imagens JPEG, uma por página. */
function bytesParaTexto_(b){ var s = [], i, n = b.length; for (i = 0; i < n; i += 8192) s.push(String.fromCharCode.apply(null, b.slice(i, i + 8192).map(function(x){ return x & 255; }))); return s.join(''); }
// imagens JPEG de um PDF (ou o próprio JPEG): [{ w, h, dados: [bytes] }]
function jpegsDe_(arquivo){
  var b = arquivo.getBlob().getBytes();
  if (/jpe?g/i.test(arquivo.getMimeType())){
    var t0 = bytesParaTexto_(b.slice(0, 65536)), m0 = /\xFF[\xC0\xC2][\s\S]{3}([\s\S]{2})([\s\S]{2})/.exec(t0);
    var h0 = m0 ? (m0[1].charCodeAt(0) << 8) + m0[1].charCodeAt(1) : 1000, w0 = m0 ? (m0[2].charCodeAt(0) << 8) + m0[2].charCodeAt(1) : 1000;
    return [{ w: w0, h: h0, dados: b }];
  }
  var t = bytesParaTexto_(b), out = [], pos = 0;
  while ((pos = t.indexOf('/DCTDecode', pos)) >= 0){
    var ini = t.lastIndexOf('<<', pos), fim = t.indexOf('>>', pos), dic = t.slice(ini, fim);
    var w = +(/\/Width\s+(\d+)/.exec(dic) || [])[1], h = +(/\/Height\s+(\d+)/.exec(dic) || [])[1], len = +(/\/Length\s+(\d+)/.exec(dic) || [])[1];
    var st = t.indexOf('stream', fim); st += 6; if (t.charAt(st) === '\r') st++; if (t.charAt(st) === '\n') st++;
    if (w && h && len) out.push({ w: w, h: h, dados: b.slice(st, st + len) });
    pos = st + (len || 1);
  }
  return out;
}
// monta um PDF A4 com uma imagem por página
function pdfDeJpegs_(imgs){
  var partes = [], tam = 0, offs = [];
  function txt(s){ var by = Utilities.newBlob(s).getBytes(); partes.push(by); tam += by.length; }
  function bin(by){ partes.push(by); tam += by.length; }
  var n = imgs.length, kids = [];
  for (var i = 0; i < n; i++) kids.push((3 + i * 3) + ' 0 R');
  txt('%PDF-1.4\n');
  offs[1] = tam; txt('1 0 obj\n<< /Type /Catalog /Pages 2 0 R >>\nendobj\n');
  offs[2] = tam; txt('2 0 obj\n<< /Type /Pages /Kids [' + kids.join(' ') + '] /Count ' + n + ' >>\nendobj\n');
  imgs.forEach(function(im, i){
    var pg = 3 + i * 3, ct = pg + 1, io = pg + 2, W = 595.28, H = 841.89, M = 22.68;
    var k = Math.min((W - 2 * M) / im.w, (H - 2 * M) / im.h), dw = im.w * k, dh = im.h * k, x = (W - dw) / 2, y = (H - dh) / 2;
    var conteudo = 'q ' + dw.toFixed(2) + ' 0 0 ' + dh.toFixed(2) + ' ' + x.toFixed(2) + ' ' + y.toFixed(2) + ' cm /Im' + i + ' Do Q';
    offs[pg] = tam; txt(pg + ' 0 obj\n<< /Type /Page /Parent 2 0 R /MediaBox [0 0 ' + W + ' ' + H + '] /Resources << /XObject << /Im' + i + ' ' + io + ' 0 R >> >> /Contents ' + ct + ' 0 R >>\nendobj\n');
    offs[ct] = tam; txt(ct + ' 0 obj\n<< /Length ' + conteudo.length + ' >>\nstream\n' + conteudo + '\nendstream\nendobj\n');
    offs[io] = tam; txt(io + ' 0 obj\n<< /Type /XObject /Subtype /Image /Width ' + im.w + ' /Height ' + im.h + ' /ColorSpace /DeviceRGB /BitsPerComponent 8 /Filter /DCTDecode /Length ' + im.dados.length + ' >>\nstream\n');
    bin(im.dados); txt('\nendstream\nendobj\n');
  });
  var total = 3 + n * 3, xref = tam, linhas = ['xref\n0 ' + total + '\n0000000000 65535 f \n'];
  for (var o = 1; o < total; o++) linhas.push(('0000000000' + offs[o]).slice(-10) + ' 00000 n \n');
  txt(linhas.join('') + 'trailer\n<< /Size ' + total + ' /Root 1 0 R >>\nstartxref\n' + xref + '\n%%EOF');
  var tudo = []; partes.forEach(function(p){ for (var j = 0; j < p.length; j++) tudo.push(p[j]); });
  return Utilities.newBlob(tudo, 'application/pdf');
}
function organizarPasta_(pasta){
  var todos = [], it = pasta.getFiles(); while (it.hasNext()) todos.push(it.next());
  var sub = pasta.getFoldersByName('Imagens escaneadas'); if (sub.hasNext()){ var it2 = sub.next().getFiles(); while (it2.hasNext()) todos.push(it2.next()); }
  var acha = function(re, so){ return todos.filter(function(a){ return !a.isTrashed() && re.test(a.getName()) && (!so || so.test(a.getMimeType())); }); };
  var feito = [];
  var pessoais = [].concat(acha(/^RG - frente/i, /pdf/), acha(/^RG - verso/i, /pdf/), acha(/^CPF/i, /pdf/), acha(/^Conta de luz/i, /pdf/));
  if (pessoais.length && !acha(/^DOCUMENTOS PESSOAIS\.pdf$/i).length){
    var imgs = []; pessoais.forEach(function(a){ imgs = imgs.concat(jpegsDe_(a)); });
    if (imgs.length){
      pasta.createFile(pdfDeJpegs_(imgs).setName('DOCUMENTOS PESSOAIS.pdf'));
      pessoais.forEach(function(a){ a.setTrashed(true); });
      feito.push('documentos pessoais (' + pessoais.length + ' arquivos, ' + imgs.length + ' páginas)');
    }
  }
  acha(/^Procura[çc][ãa]o.*\.pdf$/i).forEach(function(a, i){ if (a.getName() !== 'PROCURAÇÃO.pdf'){ a.setName(i ? 'PROCURAÇÃO ' + (i + 1) + '.pdf' : 'PROCURAÇÃO.pdf'); feito.push('procuração'); } });
  acha(/^(RG - frente|RG - verso|CPF|Conta de luz|Procuração|Documento a rogo|Documentos de quem assina a rogo|Outro documento)/i, /jpe?g/).forEach(function(a){ a.setTrashed(true); });
  acha(/^00 - Documentos completos/i).forEach(function(a){ a.setTrashed(true); });
  var foto = acha(/^(Foto do cliente|FOTO DO CLIENTE)/i, /image/)[0];
  if (foto){
    if (foto.getName() !== 'FOTO DO CLIENTE.jpg'){ foto.setName('FOTO DO CLIENTE.jpg'); try { foto.moveTo(pasta); } catch (x){} feito.push('foto'); }
    var seg = PropertiesService.getScriptProperties().getProperty('SEGREDO_SISTEMA'), mini = null;
    try { mini = foto.getThumbnail(); } catch (x){}
    if (seg && mini){ rpc('campo_foto_pasta', { p_segredo: seg, p_pasta: pasta.getId(), p_foto: 'data:image/png;base64,' + Utilities.base64Encode(mini.getBytes()) }); feito.push('foto no sistema'); }
  }
  return feito;
}
function organizarExistentes(){
  var raiz = DriveApp.getFolderById(PASTA_CLIENTES), log = [];
  [PENDENTES, PROTOCOLADOS].forEach(function(n){
    var it = subpasta(raiz, n).getFolders();
    while (it.hasNext()){
      var f = it.next();
      // só as pastas que vieram do celular (têm os nomes de arquivo do aplicativo)
      var doCelular = f.searchFiles("title contains 'Procuração' or title contains 'Foto do cliente' or title contains 'Conta de luz' or title contains 'RG - frente'").hasNext();
      if (!doCelular){ var s2 = f.getFoldersByName('Imagens escaneadas'); doCelular = s2.hasNext() && s2.next().searchFiles("title contains 'Foto do cliente'").hasNext(); }
      if (!doCelular) continue;
      try { var r = organizarPasta_(f); if (r.length) log.push(f.getName() + ': ' + r.join(', ')); }
      catch (x){ log.push(f.getName() + ': ERRO ' + x); }
    }
  });
  console.log(log.length ? log.join('\n') : 'nada para organizar');
  return log;
}
