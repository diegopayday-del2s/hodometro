// Amigos sem servidor. Cada pessoa manda o próprio rendimento num arquivo
// (pelo WhatsApp, Drive ou e-mail) e o amigo abre esse arquivo no app. O app
// guarda os amigos à parte (loja `estado`, chave `amigos`): pedal de amigo
// nunca entra nos seus pedais, no seu progresso nem nas suas rotas.
// Sem DOM, testado em tests/amigos.test.js.
import { distancia } from './geo.js';
import { somar, doPeriodo } from './formato.js';
import { seus } from './rendimento.js';
import { assinatura, mesmoCaminho } from './rotas.js';

export const PACOTE = Object.freeze({ app: 'hodometro', tipo: 'amigo', versao: 1 });
export const MAX_ENVIO = 20;       // pedais mais recentes em cada envio
export const MAX_GUARDADOS = 60;   // pedais guardados de cada amigo
const PASSO = 15;                  // m entre pontos do trajeto enviado
const MAX_NOME = 40;

const limpa = (s, max = MAX_NOME) => String(s ?? '').replace(/\s+/g, ' ').trim().slice(0, max);
const num = v => (Number.isFinite(v) ? v : 0);

/** Perfil deste celular: id fixo (para o amigo reconhecer os envios seguintes) e nome. */
export function novoPerfil(nome = '', agora = Date.now(), sorte = Math.random) {
  return { id: 'u' + Math.round(agora).toString(36) + sorte().toString(36).slice(2, 8), nome: limpa(nome) };
}

/** Nome para mostrar: o apelido que você deu ou o nome que o amigo mandou. */
export const nomeAmigo = a => (a && (a.apelido || a.nome)) || 'Amigo';

const arred = p => [Math.round(p[0] * 1e5) / 1e5, Math.round(p[1] * 1e5) / 1e5, Math.round(num(p[2])), Number.isFinite(p[3]) ? Math.round(p[3]) : null];

/**
 * Trajeto mais leve para mandar: um ponto a cada 15 m. Mantém a saída, a
 * chegada e as duas pontas de cada trecho sem sinal, e renumera as lacunas.
 */
export function simplificar(pontos, lacunas = [], passo = PASSO) {
  const pts = pontos || [];
  const quebras = new Set((lacunas || []).map(l => l.i));
  const novo = [], mapa = new Map();
  let ult = null;
  pts.forEach((p, i) => {
    const obrigatorio = i === 0 || i === pts.length - 1 || quebras.has(i) || quebras.has(i + 1);
    if (obrigatorio || distancia(ult[0], ult[1], p[0], p[1]) >= passo) {
      mapa.set(i, novo.length);
      novo.push(arred(p));
      ult = p;
    }
  });
  return { pontos: novo, lacunas: (lacunas || []).filter(l => mapa.has(l.i)).map(l => ({ ...l, i: mapa.get(l.i) })) };
}

function pedalParaEnviar(p, comTrajeto) {
  const base = {
    id: p.id, via: p.via, inicio: p.inicio, fim: p.fim, distancia: p.distancia, tempoMov: p.tempoMov,
    tempoTotal: p.tempoTotal, velMax: p.velMax, subida: p.subida, pausas: p.pausas || 0, tempoPausas: p.tempoPausas || 0,
    parciais: (p.parciais || []).map(k => ({ km: k.km, tempo: k.tempo })),
    pontos: [], lacunas: [],
  };
  if (p.nome) base.nome = p.nome;
  if (p.via === 'manual' && p.nota) base.nota = p.nota;
  if (comTrajeto && (p.pontos || []).length > 2) Object.assign(base, simplificar(p.pontos, p.lacunas));
  return base;
}

/** Totais desde o começo, com todos os seus pedais (o envio leva só os mais recentes). */
export function resumoAmigo(pedais) {
  const meus = seus(pedais);
  const t = somar(meus);
  return {
    desde: meus.length ? Math.min(...meus.map(p => p.inicio)) : null,
    n: t.n, distancia: t.distancia, tempoMov: t.tempoMov, subida: t.subida, velMedia: t.velMedia,
    maiorPedal: meus.reduce((m, p) => Math.max(m, p.distancia || 0), 0),
  };
}

/** O arquivo que você manda para um amigo. `comTrajeto: false` manda só os números. */
export function gerarPacote(perfil, pedais, { comTrajeto = true, agora = Date.now() } = {}) {
  const recentes = seus(pedais).sort((a, b) => b.inicio - a.inicio).slice(0, MAX_ENVIO);
  return {
    ...PACOTE, enviadoEm: agora, comTrajeto,
    perfil: { id: perfil.id, nome: limpa(perfil.nome) || 'Amigo' },
    resumo: resumoAmigo(pedais),
    pedais: recentes.map(p => pedalParaEnviar(p, comTrajeto)),
  };
}

function lerPonto(q) {
  if (!Array.isArray(q) || !Number.isFinite(q[0]) || !Number.isFinite(q[1]) || Math.abs(q[0]) > 90 || Math.abs(q[1]) > 180) return null;
  return [q[0], q[1], num(q[2]), Number.isFinite(q[3]) ? q[3] : null];
}

function lerPedal(p) {
  if (!p || typeof p.id !== 'string' || !Number.isFinite(p.inicio) || !Number.isFinite(p.distancia) || p.distancia < 0) return null;
  const pontos = Array.isArray(p.pontos) ? p.pontos.slice(0, 20000).map(lerPonto).filter(Boolean) : [];
  const lacunas = Array.isArray(p.lacunas) ? p.lacunas.filter(l => l && Number.isInteger(l.i) && l.i > 0 && l.i < pontos.length).map(l => ({ i: l.i, dist: num(l.dist) })) : [];
  return {
    id: p.id.slice(0, 80), via: p.via === 'manual' ? 'manual' : 'gps', inicio: p.inicio,
    fim: Number.isFinite(p.fim) ? p.fim : p.inicio + num(p.tempoTotal) * 1000,
    distancia: p.distancia, tempoMov: num(p.tempoMov), tempoTotal: num(p.tempoTotal), velMax: num(p.velMax),
    subida: num(p.subida), pausas: num(p.pausas), tempoPausas: num(p.tempoPausas),
    parciais: Array.isArray(p.parciais) ? p.parciais.filter(k => k && Number.isFinite(k.km) && Number.isFinite(k.tempo)).slice(0, 1000).map(k => ({ km: k.km, tempo: k.tempo })) : [],
    paradas: [], lacunas, pontos,
    ...(p.nome ? { nome: limpa(p.nome, 60) } : {}),
    ...(p.nota ? { nota: limpa(p.nota, 60) } : {}),
  };
}

/**
 * Lê o arquivo de um amigo (texto ou objeto já lido). Joga erro com
 * `code` 'formato' (não é um arquivo de amigo) ou 'versao' (feito por um app mais novo).
 */
export function lerPacote(dados) {
  let o = dados;
  if (typeof o === 'string') { try { o = JSON.parse(o); } catch { o = null; } }
  const erro = code => Object.assign(new Error(code), { code });
  if (!o || o.app !== PACOTE.app || o.tipo !== PACOTE.tipo || !o.perfil || typeof o.perfil.id !== 'string') throw erro('formato');
  if (!(o.versao >= 1)) throw erro('formato');
  if (o.versao > PACOTE.versao) throw erro('versao');
  const pedais = (Array.isArray(o.pedais) ? o.pedais : []).slice(0, MAX_GUARDADOS).map(lerPedal).filter(Boolean);
  const r = o.resumo || {};
  return {
    enviadoEm: Number.isFinite(o.enviadoEm) ? o.enviadoEm : 0,
    perfil: { id: o.perfil.id.slice(0, 40), nome: limpa(o.perfil.nome) || 'Amigo' },
    resumo: {
      desde: Number.isFinite(r.desde) ? r.desde : null, n: num(r.n), distancia: num(r.distancia),
      tempoMov: num(r.tempoMov), subida: num(r.subida), velMedia: num(r.velMedia), maiorPedal: num(r.maiorPedal),
    },
    pedais,
  };
}

/**
 * Junta um arquivo recebido à lista de amigos. O mesmo amigo (mesmo id) é
 * atualizado; pedais repetidos são trocados pelo mais novo, sem perder o
 * trajeto que já tinha. Devolve { amigos, amigo, novo, novos }.
 */
export function juntarAmigo(amigos, pacote, agora = Date.now()) {
  const lista = (amigos || []).map(a => ({ ...a }));
  let amigo = lista.find(a => a.id === pacote.perfil.id);
  const novo = !amigo;
  if (!amigo) { amigo = { id: pacote.perfil.id, nome: pacote.perfil.nome, desde: agora, pedais: [] }; lista.push(amigo); }
  if (!amigo.enviadoEm || pacote.enviadoEm >= amigo.enviadoEm) {
    amigo.nome = pacote.perfil.nome;
    amigo.resumo = pacote.resumo;
    amigo.enviadoEm = pacote.enviadoEm;
  }
  amigo.recebidoEm = agora;
  const porId = new Map((amigo.pedais || []).map(p => [p.id, p]));
  let novos = 0;
  for (const p of pacote.pedais) {
    const velho = porId.get(p.id);
    if (!velho) novos++;
    porId.set(p.id, velho && !p.pontos.length && velho.pontos.length ? { ...p, pontos: velho.pontos, lacunas: velho.lacunas } : p);
  }
  amigo.pedais = [...porId.values()].sort((a, b) => b.inicio - a.inicio).slice(0, MAX_GUARDADOS);
  return { amigos: lista, amigo, novo, novos };
}

/**
 * Ranking de você com os amigos: distância na semana, no mês ou desde o
 * começo. Para "total" o amigo usa o resumo que mandou (conta todos os pedais dele).
 */
export function ranking(eu, amigos, periodo = 'semana', agora = Date.now()) {
  const linha = (id, nome, pedais, resumo, voce) => {
    const t = periodo === 'total' && resumo ? resumo : somar(doPeriodo((pedais || []).filter(p => !p.demo), periodo, agora));
    return { id, nome, voce, distancia: t.distancia, tempoMov: t.tempoMov, n: t.n, velMedia: t.velMedia };
  };
  const linhas = [linha('eu', eu.nome, seus(eu.pedais), null, true), ...(amigos || []).map(a => linha(a.id, nomeAmigo(a), a.pedais, a.resumo, false))];
  return linhas.sort((a, b) => b.distancia - a.distancia || b.tempoMov - a.tempoMov || (a.voce ? -1 : 1));
}

/** Posição [lat, lon] do pedal no instante `t` (ms), ou null fora do trajeto. */
export function posicaoEm(p, t) {
  const pts = p.pontos || [];
  if (pts.length < 2) return null;
  const tr = (t - p.inicio) / 1000;
  if (tr < pts[0][2] || tr > pts[pts.length - 1][2]) return null;
  let lo = 0, hi = pts.length - 1;
  while (hi - lo > 1) { const m = (lo + hi) >> 1; if (pts[m][2] <= tr) lo = m; else hi = m; }
  const a = pts[lo], b = pts[hi];
  const f = b[2] > a[2] ? (tr - a[2]) / (b[2] - a[2]) : 0;
  return [a[0] + (b[0] - a[0]) * f, a[1] + (b[1] - a[1]) * f];
}

const fimDe = p => p.fim || p.inicio + num(p.tempoTotal) * 1000;

/**
 * Os dois pedais foram juntos? O horário precisa coincidir em pelo menos
 * metade do pedal mais curto e, com trajeto, os dois ficam a menos de 150 m
 * um do outro em 70% dos instantes. Sem trajeto: saída com até 10 min de
 * diferença e distância parecida.
 */
export function juntos(a, b) {
  const ini = Math.max(a.inicio, b.inicio), fim = Math.min(fimDe(a), fimDe(b));
  const curto = Math.min(fimDe(a) - a.inicio, fimDe(b) - b.inicio);
  if (fim - ini <= 0 || fim - ini < 0.5 * curto) return false;
  if ((a.pontos || []).length >= 3 && (b.pontos || []).length >= 3) {
    const passo = Math.max(15000, (fim - ini) / 60);
    let vistos = 0, perto = 0;
    for (let t = ini; t <= fim; t += passo) {
      const pa = posicaoEm(a, t), pb = posicaoEm(b, t);
      if (!pa || !pb) continue;
      vistos++;
      if (distancia(pa[0], pa[1], pb[0], pb[1]) <= 150) perto++;
    }
    return vistos >= 3 && perto / vistos >= 0.7;
  }
  return Math.abs(a.inicio - b.inicio) <= 600000 && Math.abs(a.distancia - b.distancia) <= 0.25 * Math.max(a.distancia, b.distancia);
}

/** Amigos que pedalaram junto com você neste pedal: [{amigo, pedal}]. */
export function companhia(meu, amigos) {
  if (!meu || meu.demo) return [];
  const out = [];
  for (const a of amigos || []) {
    const p = (a.pedais || []).find(x => juntos(meu, x));
    if (p) out.push({ amigo: a, pedal: p });
  }
  return out;
}

/** Números lado a lado do mesmo pedal gravado em dois celulares. */
export function comparar(meu, deles) {
  const media = p => (p.tempoMov > 0 ? p.distancia / p.tempoMov : 0);
  const par = (eu, ele) => ({ eu, ele, dif: ele - eu, pct: eu > 0 ? (ele - eu) / eu : null });
  return {
    distancia: par(meu.distancia, deles.distancia),
    tempoMov: par(meu.tempoMov, deles.tempoMov),
    velMedia: par(media(meu), media(deles)),
    velMax: par(meu.velMax || 0, deles.velMax || 0),
    subida: par(meu.subida || 0, deles.subida || 0),
  };
}

/**
 * Ranking de uma rota com os amigos: o melhor tempo de cada pessoa.
 * `meusIds`: os seus pedais nesta rota (tentativas). Pedal de amigo entra se
 * fez o mesmo caminho (mesma regra das rotas).
 */
export function rankingRota(rota, meusIds, meusPedais, amigos, nomeEu = 'Você') {
  const melhor = l => l.filter(p => p.tempoMov > 0).reduce((m, p) => (!m || p.tempoMov < m.tempoMov ? p : m), null);
  const linhas = [];
  const meu = melhor((meusIds || []).map(id => meusPedais.find(p => p.id === id)).filter(Boolean));
  if (meu) linhas.push({ id: 'eu', nome: nomeEu, voce: true, tempo: meu.tempoMov, pedal: meu });
  for (const a of amigos || []) {
    const naRota = (a.pedais || []).filter(p => { const s = assinatura(p); return s && mesmoCaminho(rota, s); });
    const m = melhor(naRota);
    if (m) linhas.push({ id: a.id, nome: nomeAmigo(a), voce: false, tempo: m.tempoMov, pedal: m, amigo: a, vezes: naRota.length });
  }
  return linhas.sort((x, y) => x.tempo - y.tempo);
}
