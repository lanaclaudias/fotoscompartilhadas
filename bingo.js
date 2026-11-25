// Bingo do casamento: rotas /api/bingo/* (convidados) e /api/bingo/admin/* (equipe que sorteia).
// Os convidados consultam /api/bingo/estado a cada poucos segundos, então tudo atualiza sem recarregar a página.
const express = require('express');
const crypto = require('crypto');

const LETRAS = 'BINGO';
const CENTRO = 12;
// Linhas, colunas e diagonais (posições 0..24 da cartela, linha por linha)
const LINHAS = [];
for (let i = 0; i < 5; i++) {
  LINHAS.push([0, 1, 2, 3, 4].map((j) => i * 5 + j));
  LINHAS.push([0, 1, 2, 3, 4].map((j) => j * 5 + i));
}
LINHAS.push([0, 6, 12, 18, 24], [4, 8, 12, 16, 20]);

function gerarCartela() {
  const colunas = [];
  for (let c = 0; c < 5; c++) {
    const pool = Array.from({ length: 15 }, (_, k) => c * 15 + k + 1);
    for (let k = pool.length - 1; k > 0; k--) {
      const r = crypto.randomInt(k + 1);
      [pool[k], pool[r]] = [pool[r], pool[k]];
    }
    colunas.push(pool.slice(0, 5).sort((a, b) => a - b));
  }
  const numeros = [];
  for (let l = 0; l < 5; l++) for (let c = 0; c < 5; c++) numeros.push(colunas[c][l]);
  numeros[CENTRO] = 0;
  return numeros;
}

function cartelaValida(n) {
  if (!Array.isArray(n) || n.length !== 25 || n[CENTRO] !== 0) return false;
  const vistos = new Set();
  return n.every((v, i) => {
    if (i === CENTRO) return true;
    const c = i % 5;
    if (!Number.isInteger(v) || v < c * 15 + 1 || v > c * 15 + 15 || vistos.has(v)) return false;
    vistos.add(v);
    return true;
  });
}

function venceu(numeros, sorteados, modo) {
  const ok = (i) => i === CENTRO || sorteados.has(numeros[i]);
  return modo === 'linha' ? LINHAS.some((l) => l.every(ok)) : numeros.every((_, i) => ok(i));
}

// Para cada cartela vencedora, descobre em qual número ela bateu (para ordenar quem bateu primeiro)
function calcularGanhadores(cartelas, ordem, modo) {
  const ganhadores = [];
  const total = new Set(ordem);
  for (const c of cartelas) {
    if (!venceu(c.numeros, total, modo)) continue;
    const parcial = new Set();
    let k = 0;
    for (; k < ordem.length; k++) {
      parcial.add(ordem[k]);
      if (venceu(c.numeros, parcial, modo)) break;
    }
    ganhadores.push({ id: c.id, numero: c.numero, nome: c.nome, noNumero: ordem[k], ordem: k + 1 });
  }
  return ganhadores.sort((a, b) => a.ordem - b.ordem || a.numero - b.numero);
}

// Acesso ao banco (Supabase). Pode ser trocado por outro objeto com as mesmas funções.
function bancoSupabase(supabase) {
  const falhou = (error) => { if (error) throw error; };
  return {
    async rodadaAtual() {
      const { data, error } = await supabase.from('bingo_rodadas').select('*').order('id', { ascending: false }).limit(1).maybeSingle();
      falhou(error);
      return data;
    },
    async criarRodada(modo) {
      const { data, error } = await supabase.from('bingo_rodadas').insert({ modo }).select('*').single();
      falhou(error);
      return data;
    },
    async atualizarRodada(id, campos) {
      const { data, error } = await supabase.from('bingo_rodadas')
        .update({ ...campos, atualizada_em: new Date().toISOString() }).eq('id', id).select('*').single();
      falhou(error);
      return data;
    },
    async marcarNumero(rodadaId, numero) {
      const { error } = await supabase.from('bingo_sorteados').insert({ rodada_id: rodadaId, numero });
      if (error && error.code !== '23505') throw error; // 23505 = já estava marcado
    },
    async desmarcarNumero(rodadaId, numero) {
      const { error } = await supabase.from('bingo_sorteados').delete().eq('rodada_id', rodadaId).eq('numero', numero);
      falhou(error);
    },
    async numerosDaRodada(rodadaId) {
      const { data, error } = await supabase.from('bingo_sorteados').select('numero')
        .eq('rodada_id', rodadaId).order('sorteado_em', { ascending: true });
      falhou(error);
      return data.map((r) => r.numero);
    },
    async inserirCartelas(linhas) {
      const { data, error } = await supabase.from('bingo_cartelas').insert(linhas).select('id, numero, nome, numeros, criada_em');
      falhou(error);
      return data;
    },
    async cartelasDoConvidado(convidadoId) {
      const { data, error } = await supabase.from('bingo_cartelas').select('id, numero, nome, numeros, criada_em')
        .eq('convidado_id', convidadoId).order('numero', { ascending: true });
      falhou(error);
      return data;
    },
    async todasCartelas() {
      const linhas = [];
      for (let de = 0; ; de += 1000) {
        const { data, error } = await supabase.from('bingo_cartelas').select('id, numero, nome, numeros, convidado_id')
          .order('numero', { ascending: true }).range(de, de + 999);
        falhou(error);
        linhas.push(...data);
        if (data.length < 1000) break;
      }
      return linhas;
    },
  };
}

module.exports = function rotasBingo({ supabase, banco, exigirPainel, limparTexto, iguais, idValido, segredo, opcoes = {} }) {
  const router = express.Router();
  const db = banco || (supabase ? bancoSupabase(supabase) : null);
  const PRECO = Number(opcoes.preco || 0);
  const MAX_POR_COMPRA = Math.min(Number(opcoes.maxPorCompra || 10), 20);
  const MAX_POR_CONVIDADO = Number(opcoes.maxPorConvidado || 30);
  const PAGAMENTO = opcoes.pagamento || 'teste'; // 'teste' = confirma sem cobrar. InfinitePay entra aqui depois.

  const assinar = (numeros) => crypto.createHmac('sha256', segredo).update(`bingo:${numeros.join(',')}`).digest('hex').slice(0, 32);
  const dados = (r) => ({
    rodada: r ? r.id : 0,
    modo: r ? r.modo : 'cheia',
    sorteados: r ? r.sorteados : [],
    ganhadores: r ? r.ganhadores : [],
    atualizadaEm: r ? r.atualizada_em : null,
    vendasAbertas: !r || r.sorteados.length === 0,
  });
  const cartelaCliente = (c) => ({ id: c.id, numero: Number(c.numero), nome: c.nome, numeros: c.numeros });

  router.use('/api/bingo', (req, res, next) => {
    res.setHeader('Cache-Control', 'no-store');
    if (!db) return res.status(500).json({ erro: 'Supabase não configurado no servidor' });
    next();
  });

  const tratar = (fn) => async (req, res) => {
    try { await fn(req, res); } catch (e) {
      console.error('bingo', req.path, e);
      const semTabela = e && (e.code === '42P01' || e.code === 'PGRST205');
      res.status(500).json({ erro: semTabela ? 'As tabelas do bingo ainda não foram criadas no Supabase (rode supabase/bingo.sql)' : 'Algo deu errado. Tente de novo.' });
    }
  };

  // Recalcula a lista de números e os ganhadores da rodada
  async function recalcular(rodada, campos = {}) {
    const modo = campos.modo || rodada.modo;
    const sorteados = await db.numerosDaRodada(rodada.id);
    const ganhadores = calcularGanhadores(await db.todasCartelas(), sorteados, modo);
    return db.atualizarRodada(rodada.id, { ...campos, sorteados, ganhadores });
  }

  async function rodadaOuNova() {
    return (await db.rodadaAtual()) || db.criarRodada('cheia');
  }

  // ---------- Convidados ----------
  router.get('/api/bingo/estado', tratar(async (req, res) => {
    res.json({ ...dados(await db.rodadaAtual()), preco: PRECO, pagamento: PAGAMENTO, maxPorCompra: MAX_POR_COMPRA });
  }));

  router.get('/api/bingo/cartelas', tratar(async (req, res) => {
    const id = String(req.query.convidadoId || '');
    if (!idValido.test(id)) return res.status(400).json({ erro: 'Convidado inválido' });
    res.json({ cartelas: (await db.cartelasDoConvidado(id)).map(cartelaCliente) });
  }));

  // Gera cartelas novas (ainda não compradas). Cada uma vem assinada, para não poder ser alterada no celular.
  router.post('/api/bingo/gerar', tratar(async (req, res) => {
    const qtd = Math.max(1, Math.min(MAX_POR_COMPRA, Number((req.body || {}).quantidade) || 1));
    res.json({ cartelas: Array.from({ length: qtd }, () => { const numeros = gerarCartela(); return { numeros, assinatura: assinar(numeros) }; }) });
  }));

  router.post('/api/bingo/comprar', tratar(async (req, res) => {
    const b = req.body || {};
    const convidadoId = String(b.convidadoId || '');
    const nome = limparTexto(b.nome, 60);
    const lista = Array.isArray(b.cartelas) ? b.cartelas : [];
    if (!idValido.test(convidadoId)) return res.status(400).json({ erro: 'Convidado inválido' });
    if (!nome) return res.status(400).json({ erro: 'Informe seu nome' });
    if (!lista.length || lista.length > MAX_POR_COMPRA) return res.status(400).json({ erro: `Escolha de 1 a ${MAX_POR_COMPRA} cartelas` });
    for (const c of lista) {
      const n = c && c.numeros;
      if (!cartelaValida(n) || !iguais(assinar(n), String(c.assinatura || ''))) {
        return res.status(400).json({ erro: 'Cartela inválida. Gere as cartelas de novo.' });
      }
    }
    if (!dados(await db.rodadaAtual()).vendasAbertas) {
      return res.status(409).json({ erro: 'A rodada já começou. As vendas voltam a abrir na próxima rodada.' });
    }
    const atuais = await db.cartelasDoConvidado(convidadoId);
    if (atuais.length + lista.length > MAX_POR_CONVIDADO) {
      return res.status(400).json({ erro: `Cada convidado pode ter no máximo ${MAX_POR_CONVIDADO} cartelas` });
    }
    if (PAGAMENTO !== 'teste') return res.status(501).json({ erro: 'Pagamento ainda não configurado' });

    const novas = await db.inserirCartelas(lista.map((c) => ({ convidado_id: convidadoId, nome, numeros: c.numeros, pagamento: 'teste' })));
    res.json({ ok: true, cartelas: novas.map(cartelaCliente) });
  }));

  // ---------- Equipe que sorteia (mesma senha do painel) ----------
  router.get('/api/bingo/admin/estado', exigirPainel, tratar(async (req, res) => {
    const rodada = await rodadaOuNova();
    const cartelas = await db.todasCartelas();
    res.json({
      ...dados(rodada),
      cartelasVendidas: cartelas.length,
      compradores: new Set(cartelas.map((c) => c.convidado_id)).size,
    });
  }));

  router.post('/api/bingo/admin/numero', exigirPainel, tratar(async (req, res) => {
    const numero = Number((req.body || {}).numero);
    if (!Number.isInteger(numero) || numero < 1 || numero > 75) return res.status(400).json({ erro: 'Número de 1 a 75' });
    const rodada = await rodadaOuNova();
    if ((req.body || {}).marcado === false) await db.desmarcarNumero(rodada.id, numero);
    else await db.marcarNumero(rodada.id, numero);
    res.json(dados(await recalcular(rodada)));
  }));

  router.post('/api/bingo/admin/modo', exigirPainel, tratar(async (req, res) => {
    const modo = (req.body || {}).modo === 'linha' ? 'linha' : 'cheia';
    res.json(dados(await recalcular(await rodadaOuNova(), { modo })));
  }));

  router.post('/api/bingo/admin/nova-rodada', exigirPainel, tratar(async (req, res) => {
    const modo = (req.body || {}).modo === 'linha' ? 'linha' : 'cheia';
    res.json(dados(await db.criarRodada(modo)));
  }));

  return router;
};

module.exports.LETRAS = LETRAS;
module.exports.gerarCartela = gerarCartela;
module.exports.calcularGanhadores = calcularGanhadores;
