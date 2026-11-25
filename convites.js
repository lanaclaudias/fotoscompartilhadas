// Convites digitais: a noiva cria um convite por família/grupo no painel, cada um com seu link e QR Code.
// O QR Code do convite abre /entrada?c=CODIGO, que libera a entrada (só para quem está logado no painel).
const express = require('express');
const crypto = require('crypto');
const QRCode = require('qrcode');

const ALFABETO = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789'; // sem 0/O e 1/I
const CODIGO_VALIDO = /^[A-Z2-9]{8}$/;
const UUID = /^[0-9a-f-]{36}$/i;

function novoCodigo() {
  let s = '';
  for (let i = 0; i < 8; i++) s += ALFABETO[crypto.randomInt(ALFABETO.length)];
  return s;
}

function bancoSupabase(supabase) {
  const falhou = (error) => { if (error) throw error; };
  const T = 'convites';
  return {
    async listar() {
      const { data, error } = await supabase.from(T).select('*').order('numero', { ascending: false });
      falhou(error);
      return data;
    },
    async criar(linha) {
      const { data, error } = await supabase.from(T).insert(linha).select('*').single();
      if (error && error.code === '23505') return null; // código repetido: tenta outro
      falhou(error);
      return data;
    },
    async porCodigo(codigo) {
      const { data, error } = await supabase.from(T).select('*').eq('codigo', codigo).maybeSingle();
      falhou(error);
      return data;
    },
    async atualizar(id, campos) {
      const { data, error } = await supabase.from(T).update(campos).eq('id', id).select('*').maybeSingle();
      falhou(error);
      return data;
    },
    // Marca a entrada só se ainda não entrou (evita dois celulares liberando o mesmo convite)
    async marcarEntrada(codigo) {
      const { data, error } = await supabase.from(T).update({ entrada_em: new Date().toISOString() })
        .eq('codigo', codigo).is('entrada_em', null).select('*').maybeSingle();
      falhou(error);
      return data;
    },
    async apagar(id) {
      const { error } = await supabase.from(T).delete().eq('id', id);
      falhou(error);
    },
  };
}

module.exports = function rotasConvites({ supabase, banco, exigirPainel, limparTexto, urlDoSite, config }) {
  const router = express.Router();
  const db = banco || (supabase ? bancoSupabase(supabase) : null);
  const textos = config.convite || {};

  const paraCliente = (c, req) => ({
    id: c.id,
    numero: Number(c.numero),
    codigo: c.codigo,
    nomes: c.nomes,
    pessoas: c.pessoas,
    criadoEm: c.criado_em,
    entradaEm: c.entrada_em,
    link: `${urlDoSite(req)}/convite?c=${c.codigo}`,
  });

  router.use(['/api/convite', '/api/convites', '/api/entrada', '/api/painel/convites'], (req, res, next) => {
    res.setHeader('Cache-Control', 'no-store');
    if (!db) return res.status(500).json({ erro: 'Supabase não configurado no servidor' });
    next();
  });

  const tratar = (fn) => async (req, res) => {
    try { await fn(req, res); } catch (e) {
      console.error('convites', req.path, e);
      const semTabela = e && (e.code === '42P01' || e.code === 'PGRST205');
      res.status(500).json({ erro: semTabela ? 'A tabela de convites ainda não foi criada no Supabase (rode supabase/convites.sql)' : 'Algo deu errado. Tente de novo.' });
    }
  };

  // ---------- Público: o convite ----------
  router.get('/api/convite/:codigo', tratar(async (req, res) => {
    const codigo = String(req.params.codigo).toUpperCase();
    const c = CODIGO_VALIDO.test(codigo) && await db.porCodigo(codigo);
    if (!c) return res.status(404).json({ erro: 'Convite não encontrado' });
    res.json({
      numero: Number(c.numero), codigo: c.codigo, nomes: c.nomes, pessoas: c.pessoas,
      noivos: config.noivos, data: config.data, horario: config.horario || '',
      textos,
    });
  }));

  // QR Code do convite: aponta para a página de entrada
  router.get('/api/convite/:codigo/qr.svg', tratar(async (req, res) => {
    const codigo = String(req.params.codigo).toUpperCase();
    if (!CODIGO_VALIDO.test(codigo)) return res.status(404).end();
    const svg = await QRCode.toString(`${urlDoSite(req)}/entrada?c=${codigo}`, {
      type: 'svg', margin: 1, errorCorrectionLevel: 'M', color: { dark: '#26321f', light: '#fffdf8' },
    });
    res.type('image/svg+xml').send(svg);
  }));

  // Mesmo QR em PNG (usado para montar a imagem que o convidado baixa)
  router.get('/api/convite/:codigo/qr.png', tratar(async (req, res) => {
    const codigo = String(req.params.codigo).toUpperCase();
    if (!CODIGO_VALIDO.test(codigo)) return res.status(404).end();
    const png = await QRCode.toBuffer(`${urlDoSite(req)}/entrada?c=${codigo}`, {
      width: 800, margin: 1, errorCorrectionLevel: 'M', color: { dark: '#26321f', light: '#fffdf8' },
    });
    res.type('png').send(png);
  }));

  // ---------- Entrada (equipe logada no painel lê o QR Code) ----------
  router.post('/api/entrada', exigirPainel, tratar(async (req, res) => {
    const codigo = String((req.body || {}).codigo || '').toUpperCase();
    const c = CODIGO_VALIDO.test(codigo) && await db.porCodigo(codigo);
    if (!c) return res.status(404).json({ erro: 'Convite não encontrado' });
    if (c.entrada_em) return res.json({ status: 'ja-entrou', convite: paraCliente(c, req) });
    const marcado = await db.marcarEntrada(codigo);
    if (!marcado) return res.json({ status: 'ja-entrou', convite: paraCliente(await db.porCodigo(codigo), req) });
    res.json({ status: 'liberado', convite: paraCliente(marcado, req) });
  }));

  // ---------- Painel: criar e gerenciar convites ----------
  router.get('/api/painel/convites', exigirPainel, tratar(async (req, res) => {
    res.json({ convites: (await db.listar()).map((c) => paraCliente(c, req)) });
  }));

  router.post('/api/painel/convites', exigirPainel, tratar(async (req, res) => {
    const nomes = limparTexto((req.body || {}).nomes, 120);
    const pessoas = Math.max(1, Math.min(20, Number((req.body || {}).pessoas) || 1));
    if (!nomes) return res.status(400).json({ erro: 'Escreva o nome do convidado ou dos convidados' });
    let c = null;
    for (let i = 0; i < 5 && !c; i++) c = await db.criar({ codigo: novoCodigo(), nomes, pessoas });
    if (!c) throw new Error('Não foi possível gerar um código único');
    res.json({ convite: paraCliente(c, req) });
  }));

  router.use('/api/painel/convites/:id', (req, res, next) => {
    if (!UUID.test(req.params.id)) return res.status(404).json({ erro: 'Convite não encontrado' });
    next();
  });

  router.patch('/api/painel/convites/:id', exigirPainel, tratar(async (req, res) => {
    const b = req.body || {};
    const campos = {};
    if (b.nomes !== undefined) {
      campos.nomes = limparTexto(b.nomes, 120);
      if (!campos.nomes) return res.status(400).json({ erro: 'Escreva o nome do convidado' });
    }
    if (b.pessoas !== undefined) campos.pessoas = Math.max(1, Math.min(20, Number(b.pessoas) || 1));
    if (b.entrou !== undefined) campos.entrada_em = b.entrou ? new Date().toISOString() : null;
    const c = await db.atualizar(req.params.id, campos);
    if (!c) return res.status(404).json({ erro: 'Convite não encontrado' });
    res.json({ convite: paraCliente(c, req) });
  }));

  router.delete('/api/painel/convites/:id', exigirPainel, tratar(async (req, res) => {
    await db.apagar(req.params.id);
    res.json({ ok: true });
  }));

  return router;
};
