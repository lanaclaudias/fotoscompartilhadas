// App Express. Funciona tanto localmente (via local.js) quanto na Vercel (export padrão).
try { process.loadEnvFile(); } catch { /* sem .env: na Vercel as variáveis vêm do painel */ }

const express = require('express');
const QRCode = require('qrcode');
const crypto = require('crypto');
const path = require('path');
const os = require('os');
const { createClient } = require('@supabase/supabase-js');
const config = require('./config.json');

// ---------- Configuração ----------
const SENHA = process.env.ADMIN_PASSWORD || '';
const URL_PUBLICA = (process.env.PUBLIC_URL || config.urlPublica || '').replace(/\/+$/, '');
const MAX_MB = Number(config.tamanhoMaximoMB || 50);
const ACEITAR_VIDEOS = config.aceitarVideos === true;
const TIPO_ACEITO = ACEITAR_VIDEOS ? /^(image|video)\// : /^image\//;
const MSG_TIPO = ACEITAR_VIDEOS ? 'Envie apenas fotos ou vídeos' : 'Por enquanto, envie apenas fotos';
const BUCKET = process.env.SUPABASE_BUCKET || 'fotos';
const TABELA = 'fotos';

const faltando = ['SUPABASE_URL', 'SUPABASE_SERVICE_ROLE_KEY', 'ADMIN_PASSWORD'].filter((k) => !process.env[k]);
if (faltando.length) console.warn(`⚠️  Variáveis não definidas: ${faltando.join(', ')} (veja .env.example)`);

const supabase = process.env.SUPABASE_URL && process.env.SUPABASE_SERVICE_ROLE_KEY
  ? createClient(process.env.SUPABASE_URL, process.env.SUPABASE_SERVICE_ROLE_KEY, {
    auth: { persistSession: false, autoRefreshToken: false },
  })
  : null;

// ---------- Utilidades ----------
function urlDoSite(req) {
  if (URL_PUBLICA) return URL_PUBLICA;
  const host = req.headers['x-forwarded-host'] || req.headers.host || '';
  const local = /^(localhost|127\.|\[::1\])/.test(host);
  if (host && !local) {
    const proto = req.headers['x-forwarded-proto'] || (process.env.VERCEL ? 'https' : 'http');
    return `${proto}://${host}`;
  }
  // Rodando no PC: usa o IP do Wi-Fi para o QR funcionar em celulares da mesma rede
  const porta = host.split(':')[1] || process.env.PORT || 3000;
  const virtual = /vEthernet|WSL|Hyper-V|VirtualBox|VMware|Docker|vbox|Loopback/i;
  for (const [nome, ifaces] of Object.entries(os.networkInterfaces())) {
    if (virtual.test(nome)) continue;
    for (const i of ifaces || []) {
      if (i.family === 'IPv4' && !i.internal) return `http://${i.address}:${porta}`;
    }
  }
  return `http://localhost:${porta}`;
}

const TOKEN_PAINEL = crypto.createHmac('sha256', SENHA || crypto.randomBytes(32)).update('painel-noivos').digest('hex');

function lerCookies(req) {
  const out = {};
  (req.headers.cookie || '').split(';').forEach((c) => {
    const i = c.indexOf('=');
    if (i > 0) out[c.slice(0, i).trim()] = decodeURIComponent(c.slice(i + 1).trim());
  });
  return out;
}

function iguais(a, b) {
  const ha = crypto.createHash('sha256').update(String(a)).digest();
  const hb = crypto.createHash('sha256').update(String(b)).digest();
  return crypto.timingSafeEqual(ha, hb);
}

function exigirPainel(req, res, next) {
  if (!iguais(lerCookies(req).painel || '', TOKEN_PAINEL)) return res.status(401).json({ erro: 'Não autorizado' });
  next();
}

function exigirSupabase(req, res, next) {
  if (!supabase) return res.status(500).json({ erro: 'Supabase não configurado no servidor' });
  next();
}

function limparTexto(s, max) {
  return String(s || '').replace(/[\u0000-\u001f<>]/g, '').trim().slice(0, max);
}

const ID_VALIDO = /^[a-zA-Z0-9-]{8,64}$/;
const CAMINHO_VALIDO = /^\d{4}-\d{2}-\d{2}\/\d+-[a-f0-9]{12}(\.[a-z0-9]{1,6})?$/;

function paraCliente(row) {
  return {
    id: row.id,
    caminho: row.caminho,
    nomeOriginal: row.nome_original,
    tipo: row.tipo,
    tamanho: row.tamanho,
    nome: row.nome,
    convidadoId: row.convidado_id,
    enviadaEm: row.enviada_em,
    tiradaEm: row.tirada_em,
  };
}

// ---------- Foto/logo do casal (guardada no Storage em _site/capa-<data>.<ext>) ----------
const PASTA_SITE = '_site';
const CAPA_VALIDA = /^_site\/capa-\d+\.(jpg|png|webp)$/;

async function listarCapas() {
  if (!supabase) return [];
  const { data } = await supabase.storage.from(BUCKET).list(PASTA_SITE, { limit: 100 });
  return (data || []).filter((o) => o.name.startsWith('capa-')).map((o) => `${PASTA_SITE}/${o.name}`).sort();
}

async function urlDaCapa() {
  const capa = (await listarCapas()).pop();
  if (!capa) return null;
  const { data } = await supabase.storage.from(BUCKET).createSignedUrl(capa, 60 * 60 * 24);
  return data ? data.signedUrl : null;
}

// ---------- App ----------
const app = express();
app.use(express.json({ limit: '50kb' }));

// Dados públicos do evento (para a página dos convidados)
app.get('/api/evento', async (req, res) => {
  let capaUrl = null;
  try { capaUrl = await urlDaCapa(); } catch { /* sem capa */ }
  res.setHeader('Cache-Control', 'no-store');
  res.json({
    noivos: config.noivos,
    data: config.data,
    mensagem: config.mensagem,
    horario: config.horario || '',
    cerimonia: config.cerimonia || '',
    recepcao: config.recepcao || '',
    tamanhoMaximoMB: MAX_MB,
    comprimirFotos: config.comprimirFotos !== false,
    aceitarVideos: ACEITAR_VIDEOS,
    capaUrl,
  });
});

// 1) Convidado pede autorização para enviar um arquivo → recebe uma URL assinada do Supabase
app.post('/api/upload/iniciar', exigirSupabase, async (req, res) => {
  const { tipo, tamanho, nomeArquivo } = req.body || {};
  if (!TIPO_ACEITO.test(String(tipo || ''))) return res.status(400).json({ erro: MSG_TIPO });
  if (!(Number(tamanho) > 0)) return res.status(400).json({ erro: 'Arquivo vazio' });
  if (Number(tamanho) > MAX_MB * 1024 * 1024) return res.status(413).json({ erro: `Arquivo maior que ${MAX_MB} MB` });

  const ext = (path.extname(String(nomeArquivo || '')) || '').toLowerCase().replace(/[^.a-z0-9]/g, '').slice(0, 7);
  const dia = new Date().toISOString().slice(0, 10);
  const caminho = `${dia}/${Date.now()}-${crypto.randomBytes(6).toString('hex')}${ext.length > 1 ? ext : ''}`;

  const { data, error } = await supabase.storage.from(BUCKET).createSignedUploadUrl(caminho);
  if (error) {
    console.error('createSignedUploadUrl', error);
    return res.status(500).json({ erro: 'Não foi possível iniciar o envio' });
  }
  res.json({ caminho, urlEnvio: data.signedUrl });
});

// 2) Depois de enviado para o Supabase, o convidado confirma → registramos quem enviou
app.post('/api/upload/confirmar', exigirSupabase, async (req, res) => {
  const b = req.body || {};
  const caminho = String(b.caminho || '');
  if (!CAMINHO_VALIDO.test(caminho)) return res.status(400).json({ erro: 'Caminho inválido' });
  if (!TIPO_ACEITO.test(String(b.tipo || ''))) return res.status(400).json({ erro: MSG_TIPO });

  // Confere se o arquivo realmente chegou no Storage
  const { error: naoExiste } = await supabase.storage.from(BUCKET).createSignedUrl(caminho, 60);
  if (naoExiste) return res.status(400).json({ erro: 'Arquivo não encontrado' });

  const tiradaEm = Number(b.tiradaEm) > 0 ? new Date(Number(b.tiradaEm)).toISOString() : null;
  const { data, error } = await supabase.from(TABELA).insert({
    caminho,
    nome_original: limparTexto(b.nomeOriginal, 120) || null,
    tipo: limparTexto(b.tipo, 100),
    tamanho: Number(b.tamanho) || null,
    nome: limparTexto(b.nome, 60) || 'Anônimo',
    convidado_id: ID_VALIDO.test(b.convidadoId || '') ? b.convidadoId : 'sem-id',
    tirada_em: tiradaEm,
  }).select('id').single();

  if (error) {
    if (error.code === '23505') return res.json({ ok: true }); // já confirmado (reenvio)
    console.error('insert', error);
    return res.status(500).json({ erro: 'Falha ao registrar a foto' });
  }
  res.json({ ok: true, id: data.id });
});

// ---------- Painel dos noivos ----------
app.post('/api/painel/login', (req, res) => {
  if (!SENHA) return res.status(500).json({ erro: 'Defina ADMIN_PASSWORD no servidor' });
  if (!iguais(String((req.body || {}).senha || ''), SENHA)) {
    return res.status(401).json({ erro: 'Senha incorreta' });
  }
  const seguro = (req.headers['x-forwarded-proto'] === 'https' || process.env.VERCEL) ? '; Secure' : '';
  res.setHeader('Set-Cookie', `painel=${TOKEN_PAINEL}; HttpOnly; Path=/; SameSite=Strict; Max-Age=${60 * 60 * 24 * 30}${seguro}`);
  res.json({ ok: true });
});

app.post('/api/painel/logout', (req, res) => {
  res.setHeader('Set-Cookie', 'painel=; HttpOnly; Path=/; SameSite=Strict; Max-Age=0');
  res.json({ ok: true });
});

// Lista todas as fotos com links temporários (1h) para exibir e baixar
app.get('/api/painel/fotos', exigirPainel, exigirSupabase, async (req, res) => {
  const linhas = [];
  for (let de = 0; ; de += 1000) {
    const { data, error } = await supabase.from(TABELA).select('*')
      .order('enviada_em', { ascending: false }).range(de, de + 999);
    if (error) {
      console.error('select', error);
      return res.status(500).json({ erro: 'Falha ao carregar as fotos' });
    }
    linhas.push(...data);
    if (data.length < 1000) break;
  }

  const fotos = linhas.map(paraCliente);
  for (let i = 0; i < fotos.length; i += 500) {
    const lote = fotos.slice(i, i + 500);
    const { data } = await supabase.storage.from(BUCKET).createSignedUrls(lote.map((f) => f.caminho), 3600);
    (data || []).forEach((s, j) => { lote[j].url = s.signedUrl; });
  }

  const convidados = {};
  for (const f of [...fotos].reverse()) {
    const c = (convidados[f.convidadoId] ||= { convidadoId: f.convidadoId, nome: f.nome, total: 0 });
    c.total++;
    c.nome = f.nome; // nome mais recente usado por esse convidado
  }

  res.json({
    fotos,
    convidados: Object.values(convidados).sort((a, b) => b.total - a.total),
    urlSite: urlDoSite(req),
  });
});

// Baixar um arquivo com o nome original
app.get('/api/painel/arquivo/:id', exigirPainel, exigirSupabase, async (req, res) => {
  const { data: f } = await supabase.from(TABELA).select('caminho, nome_original').eq('id', req.params.id).maybeSingle();
  if (!f) return res.status(404).end();
  const { data, error } = await supabase.storage.from(BUCKET)
    .createSignedUrl(f.caminho, 300, { download: f.nome_original || true });
  if (error) return res.status(404).end();
  res.redirect(data.signedUrl);
});

app.delete('/api/painel/fotos/:id', exigirPainel, exigirSupabase, async (req, res) => {
  const { data: f } = await supabase.from(TABELA).select('caminho').eq('id', req.params.id).maybeSingle();
  if (!f) return res.status(404).json({ erro: 'Não encontrada' });
  await supabase.storage.from(BUCKET).remove([f.caminho]);
  await supabase.from(TABELA).delete().eq('id', req.params.id);
  res.json({ ok: true });
});

// Lista todos os arquivos de convidados no Storage (inclui arquivos "soltos" sem registro na tabela)
async function listarArquivosConvidados() {
  const caminhos = [];
  const { data: raiz, error } = await supabase.storage.from(BUCKET).list('', { limit: 1000 });
  if (error) throw error;
  for (const item of raiz || []) {
    if (item.name === PASTA_SITE) continue; // foto do casal fica
    if (item.id) { caminhos.push(item.name); continue; } // arquivo na raiz
    for (let de = 0; ; de += 1000) { // pasta (um dia de envios)
      const { data, error: e2 } = await supabase.storage.from(BUCKET).list(item.name, { limit: 1000, offset: de });
      if (e2) throw e2;
      (data || []).filter((o) => o.id).forEach((o) => caminhos.push(`${item.name}/${o.name}`));
      if (!data || data.length < 1000) break;
    }
  }
  return caminhos;
}

// Apaga TODAS as fotos e vídeos (Storage + tabela). Exige digitar APAGAR.
app.post('/api/painel/apagar-tudo', exigirPainel, exigirSupabase, async (req, res) => {
  if ((req.body || {}).confirmacao !== 'APAGAR') return res.status(400).json({ erro: 'Confirmação inválida' });
  try {
    const caminhos = await listarArquivosConvidados();
    for (let i = 0; i < caminhos.length; i += 500) {
      const { error } = await supabase.storage.from(BUCKET).remove(caminhos.slice(i, i + 500));
      if (error) throw error;
    }
    const { error, count } = await supabase.from(TABELA).delete({ count: 'exact' }).not('id', 'is', null);
    if (error) throw error;
    res.json({ ok: true, arquivos: caminhos.length, registros: count || 0 });
  } catch (e) {
    console.error('apagar-tudo', e);
    res.status(500).json({ erro: 'Não foi possível apagar tudo. Tente novamente.' });
  }
});

// Foto do casal: 1) pede URL de envio  2) confirma (apaga as anteriores)  3) ou remove
app.post('/api/painel/capa/iniciar', exigirPainel, exigirSupabase, async (req, res) => {
  const ext = { 'image/jpeg': 'jpg', 'image/png': 'png', 'image/webp': 'webp' }[(req.body || {}).tipo];
  if (!ext) return res.status(400).json({ erro: 'Use uma imagem JPG, PNG ou WEBP' });
  const caminho = `${PASTA_SITE}/capa-${Date.now()}.${ext}`;
  const { data, error } = await supabase.storage.from(BUCKET).createSignedUploadUrl(caminho);
  if (error) return res.status(500).json({ erro: 'Não foi possível iniciar o envio' });
  res.json({ caminho, urlEnvio: data.signedUrl });
});

app.post('/api/painel/capa/confirmar', exigirPainel, exigirSupabase, async (req, res) => {
  const caminho = String((req.body || {}).caminho || '');
  if (!CAPA_VALIDA.test(caminho)) return res.status(400).json({ erro: 'Caminho inválido' });
  const antigas = (await listarCapas()).filter((c) => c !== caminho);
  if (antigas.length) await supabase.storage.from(BUCKET).remove(antigas);
  res.json({ ok: true, capaUrl: await urlDaCapa() });
});

app.delete('/api/painel/capa', exigirPainel, exigirSupabase, async (req, res) => {
  const capas = await listarCapas();
  if (capas.length) await supabase.storage.from(BUCKET).remove(capas);
  res.json({ ok: true });
});

app.get('/api/painel/qrcode.png', exigirPainel, async (req, res) => {
  const png = await QRCode.toBuffer(urlDoSite(req), { width: 1000, margin: 2, errorCorrectionLevel: 'M' });
  res.type('png');
  res.setHeader('Cache-Control', 'no-store');
  if (req.query.baixar) res.attachment('qrcode-casamento.png');
  res.send(png);
});

module.exports = app;
