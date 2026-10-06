/**
 * Cadastro pelo celular do prospectador: recebe as fotos, cria a pasta do cliente no Drive,
 * lê a procuração e o RG com o Claude e cria o cliente no sistema (aba Clientes › Sem protocolo).
 *
 * Instalação (uma vez, na conta Google do escritório):
 *  1. script.google.com › Novo projeto › cole este arquivo inteiro.
 *  2. Configurações do projeto (engrenagem) › Propriedades do script › adicione ANTHROPIC_KEY
 *     com a chave da API do Claude (console.anthropic.com). Sem ela, as fotos vão para o Drive
 *     do mesmo jeito, mas o nome e o CPF ficam para o escritório preencher.
 *  3. Implantar › Nova implantação › Tipo: App da Web · Executar como: Eu · Quem pode acessar: Qualquer pessoa.
 *  4. Copie o endereço que termina em /exec e cole no sistema: Configurações › Cadastro pelo celular.
 */
var SUPABASE_URL = 'https://etmknidodbmtpvbzgvhp.supabase.co';
var SUPABASE_KEY = 'sb_publishable_0tH0slL5lOQ06uZadSb28A__DYpJs0r'; // chave pública do site
var PASTA_CLIENTES = '117gYqpeBYMhLWENcpQo7eC7RoJebiTBx';
var MODELO = 'claude-sonnet-5-5';

var NOMES = {
  procuracao: 'Procuração', rg_frente: 'RG - frente', rg_verso: 'RG - verso', cpf: 'CPF',
  luz: 'Conta de luz', arogo: 'Documento a rogo', outro: 'Outro documento', cliente: 'Foto do cliente'
};

function doGet(){ return saida({ ok: true, servico: 'cadastro pelo celular' }); }

function doPost(e){
  try {
    var p = JSON.parse(e.postData.contents);
    var quem = validar(p.token);
    if (!/^[A-Za-z0-9_-]{8,64}$/.test(p.envio || '')) throw new Error('Envio inválido.');
    if (p.acao === 'arquivo') return saida(arquivo(p, quem));
    if (p.acao === 'fechar') return saida(fechar(p, quem));
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

function pastaDoEnvio(envio, quem){
  var props = PropertiesService.getScriptProperties(), id = props.getProperty('pasta_' + envio);
  if (id){ try { return DriveApp.getFolderById(id); } catch (x){} }
  var lock = LockService.getScriptLock(); lock.waitLock(20000);
  try {
    id = props.getProperty('pasta_' + envio);
    if (id) return DriveApp.getFolderById(id);
    var nome = 'NOVO CADASTRO - ' + (quem.nome || 'prospectador') + ' - ' + Utilities.formatDate(new Date(), 'America/Manaus', 'dd-MM-yyyy HH.mm');
    var f = DriveApp.getFolderById(PASTA_CLIENTES).createFolder(nome);
    props.setProperty('pasta_' + envio, f.getId());
    return f;
  } finally { lock.releaseLock(); }
}

function arquivo(p, quem){
  var pasta = pastaDoEnvio(p.envio, quem);
  var nome = String(p.nome || 'arquivo').replace(/[\\/:*?"<>|]/g, '').slice(0, 120);
  var sub = /\.pdf$/i.test(nome) ? pasta : subpasta(pasta, 'Imagens escaneadas');
  var ja = sub.getFilesByName(nome);
  if (!ja.hasNext()) sub.createFile(Utilities.newBlob(Utilities.base64Decode(p.b64), p.mime || 'application/octet-stream', nome));
  return { ok: true };
}

function subpasta(pasta, nome){ var it = pasta.getFoldersByName(nome); return it.hasNext() ? it.next() : pasta.createFolder(nome); }

function fechar(p, quem){
  var pasta = pastaDoEnvio(p.envio, quem);
  var dados = { nome: '', cpf: '', rg: '', nascimento: '', endereco: '' }, nota = [];
  try { dados = lerDocumentos(pasta) || dados; }
  catch (err){ nota.push('A leitura automática falhou (' + String(err.message || err).slice(0, 160) + '). Preencha pelos documentos da pasta.'); }
  if (dados.cpf && !cpfValido(dados.cpf)){ nota.push('CPF lido (' + dados.cpf + ') não confere: verifique no documento.'); }
  if (dados.observacao) nota.push(dados.observacao);
  if (p.local && p.local.lat) nota.push('Localização da casa: https://maps.google.com/?q=' + p.local.lat + ',' + p.local.lng);
  var faltam = (p.faltam || []).map(function(k){ return NOMES[k] || k; });
  if (faltam.length) nota.push('Não foi fotografado: ' + faltam.join(', ') + '.');
  nota.unshift('Cadastrado pelo celular por ' + (quem.nome || 'prospectador') + '. Conferir os dados com os documentos.');

  if (dados.nome) pasta.setName(String(dados.nome).toUpperCase());
  var id = rpc('campo_cadastrar', {
    p_token: p.token, p_envio: p.envio,
    p_dados: { nome: dados.nome, cpf: dados.cpf, rg: dados.rg, nascimento: dados.nascimento, endereco: dados.endereco,
      contato: p.contato || '', pastaUrl: pasta.getUrl(), pastaId: pasta.getId(), docs: p.docs || [], local: p.local || null, leitura: nota.join('\n') }
  });
  PropertiesService.getScriptProperties().deleteProperty('pasta_' + p.envio);
  return { ok: true, id: id, nome: dados.nome || '' };
}

/* Claude lê a procuração, o RG e o CPF (as imagens escaneadas) */
function lerDocumentos(pasta){
  var chave = PropertiesService.getScriptProperties().getProperty('ANTHROPIC_KEY');
  if (!chave) return null;
  var ordem = ['procuracao', 'rg_frente', 'rg_verso', 'cpf', 'arogo', 'luz'], imgs = [];
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
    'Extraia os dados do OUTORGANTE (o cliente), nunca do advogado. Responda só com um JSON, sem texto fora dele, no formato: ' +
    '{"nome":"","cpf":"000.000.000-00","rg":"","nascimento":"AAAA-MM-DD","endereco":"","observacao":""}. ' +
    'Nome completo em maiúsculas, como no documento. Endereço com rua, número, comunidade ou bairro e cidade. ' +
    'Deixe vazio o que não estiver legível; não invente. Em "observacao", avise em uma frase se houver divergência entre os documentos ou algo ilegível.' });
  var r = UrlFetchApp.fetch('https://api.anthropic.com/v1/messages', {
    method: 'post', contentType: 'application/json', muteHttpExceptions: true,
    headers: { 'x-api-key': chave, 'anthropic-version': '2023-06-01' },
    payload: JSON.stringify({ model: MODELO, max_tokens: 800, messages: [{ role: 'user', content: conteudo }] })
  });
  var d = JSON.parse(r.getContentText());
  if (r.getResponseCode() >= 300) throw new Error((d.error && d.error.message) || ('erro ' + r.getResponseCode()));
  var txt = (d.content || []).map(function(c){ return c.text || ''; }).join('');
  var m = txt.match(/\{[\s\S]*\}/); if (!m) throw new Error('resposta sem dados');
  var o = JSON.parse(m[0]);
  return { nome: limpa(o.nome), cpf: limpa(o.cpf), rg: limpa(o.rg), nascimento: limpa(o.nascimento), endereco: limpa(o.endereco), observacao: limpa(o.observacao) };
}
function limpa(t){ return String(t == null ? '' : t).trim().slice(0, 300); }

function cpfValido(c){
  c = String(c).replace(/\D/g, ''); if (c.length !== 11 || /^(\d)\1+$/.test(c)) return false;
  for (var t = 9; t < 11; t++){ var s = 0; for (var i = 0; i < t; i++) s += +c[i] * (t + 1 - i); if (((10 * s) % 11) % 10 !== +c[t]) return false; }
  return true;
}
