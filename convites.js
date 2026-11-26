// Convites digitais: a noiva cria um convite por família/grupo no painel, cada um com seu link e QR Code.
// Cada convite tem uma senha de 4 números. O convidado digita a senha em "Confirmar presença" e só então
// recebe o QR Code de entrada (/entrada?k=CHAVE), que libera a entrada (só para quem está logado no painel).
const express = require('express');
const crypto = require('crypto');
const QRCode = require('qrcode');

const ALFABETO = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789'; // sem 0/O e 1/I
const CODIGO_VALIDO = /^[A-Z2-9]{8}$/;
const CHAVE_VALIDA = /^[A-Z2-9]{12}$/;
const UUID = /^[0-9a-f-]{36}$/i;
const MAX_FALHAS = 5;          // senhas erradas seguidas antes de bloquear
const BLOQUEIO_MIN = 10;       // minutos de bloqueio

function aleatorio(n) {
  let s = '';
  for (let i = 0; i < n; i++) s += ALFABETO[crypto.randomInt(ALFABETO.length)];
  return s;
}
const novoCodigo = () => aleatorio(8);
const novaChave = () => aleatorio(12);
const novaSenha = () => String(crypto.randomInt(10000)).padStart(4, '0');

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
    async porChave(chave) {
      const { data, error } = await supabase.from(T).select('*').eq('chave', chave).maybeSingle();
      falhou(error);
      return data;
    },
    async atualizar(id, campos) {
      const { data, error } = await supabase.from(T).update(campos).eq('id', id).select('*').maybeSingle();
      falhou(error);
      return data;
    },
    // Marca a entrada só se ainda não entrou (evita dois celulares liberando o mesmo convite)
    async marcarEntrada(id) {
      const { data, error } = await supabase.from(T).update({ entrada_em: new Date().toISOString() })
        .eq('id', id).is('entrada_em', null).select('*').maybeSingle();
      falhou(error);
      return data;
    },
    // O convite mostra o botão do bingo quando a noiva libera a compra de cartelas
    async bingoLiberado() {
      const { data, error } = await supabase.from('bingo_config').select('vendas_liberadas').eq('id', 1).maybeSingle();
      return !error && !!(data && data.vendas_liberadas);
    },
    async apagar(id) {
      const { error } = await supabase.from(T).delete().eq('id', id);
      falhou(error);
    },
  };
}

module.exports = function rotasConvites({ supabase, banco, exigirPainel, limparTexto, iguais, urlDoSite }) {
  const router = express.Router();
  const db = banco || (supabase ? bancoSupabase(supabase) : null);

  const paraCliente = (c, req) => ({
    id: c.id,
    numero: Number(c.numero),
    codigo: c.codigo,
    nomes: c.nomes,
    pessoas: c.pessoas,
    senha: c.senha,
    criadoEm: c.criado_em,
    confirmadoEm: c.confirmado_em,
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
  const buscarPorCodigo = async (req) => {
    const codigo = String(req.params.codigo).toUpperCase();
    return CODIGO_VALIDO.test(codigo) ? db.porCodigo(codigo) : null;
  };
  // Matriz do QR Code de entrada (o convite desenha o QR na tela e no bilhete em PDF)
  const qrEntrada = (req, chave) => {
    const q = QRCode.create(`${urlDoSite(req)}/entrada?k=${chave}`, { errorCorrectionLevel: 'M' });
    const n = q.modules.size, d = q.modules.data, linhas = [];
    for (let y = 0; y < n; y++) {
      let l = '';
      for (let x = 0; x < n; x++) l += d[y * n + x] ? '1' : '0';
      linhas.push(l);
    }
    return linhas;
  };

  router.get('/api/convite/:codigo', tratar(async (req, res) => {
    const c = await buscarPorCodigo(req);
    if (!c) return res.status(404).json({ erro: 'Convite não encontrado' });
    res.json({
      numero: Number(c.numero), codigo: c.codigo, nomes: c.nomes, pessoas: c.pessoas,
      confirmado: !!c.confirmado_em, entrou: !!c.entrada_em,
      bingoLiberado: db.bingoLiberado ? await db.bingoLiberado() : false,
    });
  }));

  // Confirmar presença com a senha do convite: devolve a chave e o QR Code de entrada
  router.post('/api/convite/:codigo/confirmar', tratar(async (req, res) => {
    const c = await buscarPorCodigo(req);
    if (!c) return res.status(404).json({ erro: 'Convite não encontrado' });
    if (c.entrada_em) return res.status(409).json({ erro: 'Este convite já foi usado na entrada', entrou: true });
    if (c.senha_bloqueio && new Date(c.senha_bloqueio) > new Date()) {
      return res.status(429).json({ erro: 'Muitas tentativas. Aguarde alguns minutos e tente de novo.' });
    }
    const senha = String((req.body || {}).senha || '').trim();
    if (!c.senha || !iguais(senha, c.senha)) {
      const falhas = (c.senha_falhas || 0) + 1;
      const bloquear = falhas >= MAX_FALHAS;
      await db.atualizar(c.id, {
        senha_falhas: bloquear ? 0 : falhas,
        senha_bloqueio: bloquear ? new Date(Date.now() + BLOQUEIO_MIN * 60000).toISOString() : null,
      });
      return res.status(403).json({ erro: bloquear ? 'Muitas tentativas. Aguarde alguns minutos e tente de novo.' : 'Senha incorreta. Tente novamente.' });
    }
    const campos = { senha_falhas: 0, senha_bloqueio: null };
    if (!c.chave) campos.chave = novaChave();
    if (!c.confirmado_em) campos.confirmado_em = new Date().toISOString();
    const atual = await db.atualizar(c.id, campos);
    res.json({ chave: atual.chave, qr: qrEntrada(req, atual.chave) });
  }));

  // Convidado que já confirmou neste celular: mostra o QR de novo sem pedir a senha
  router.post('/api/convite/:codigo/bilhete', tratar(async (req, res) => {
    const c = await buscarPorCodigo(req);
    const chave = String((req.body || {}).chave || '').toUpperCase();
    if (!c || !c.chave || !iguais(chave, c.chave)) return res.status(403).json({ erro: 'Confirme a presença com a senha do convite' });
    res.json({ chave: c.chave, qr: qrEntrada(req, c.chave), entrou: !!c.entrada_em });
  }));

  // ---------- Entrada (equipe logada no painel lê o QR Code) ----------
  router.post('/api/entrada', exigirPainel, tratar(async (req, res) => {
    const chave = String((req.body || {}).chave || '').toUpperCase();
    const c = CHAVE_VALIDA.test(chave) && await db.porChave(chave);
    if (!c) return res.status(404).json({ erro: 'Convite não encontrado' });
    if (c.entrada_em) return res.json({ status: 'ja-entrou', convite: paraCliente(c, req) });
    const marcado = await db.marcarEntrada(c.id);
    if (!marcado) return res.json({ status: 'ja-entrou', convite: paraCliente(await db.porChave(chave), req) });
    res.json({ status: 'liberado', convite: paraCliente(marcado, req) });
  }));

  // ---------- Painel: criar e gerenciar convites ----------
  router.get('/api/painel/convites', exigirPainel, tratar(async (req, res) => {
    const lista = await db.listar();
    // convites criados antes de existir a senha recebem uma agora
    for (const c of lista) if (!c.senha) Object.assign(c, await db.atualizar(c.id, { senha: novaSenha() }));
    res.json({ convites: lista.map((c) => paraCliente(c, req)) });
  }));

  router.post('/api/painel/convites', exigirPainel, tratar(async (req, res) => {
    const nomes = limparTexto((req.body || {}).nomes, 120);
    const pessoas = Math.max(1, Math.min(20, Number((req.body || {}).pessoas) || 1));
    if (!nomes) return res.status(400).json({ erro: 'Escreva o nome do convidado ou dos convidados' });
    let c = null;
    for (let i = 0; i < 5 && !c; i++) c = await db.criar({ codigo: novoCodigo(), senha: novaSenha(), nomes, pessoas });
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
