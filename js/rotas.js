// Rotas: os caminhos que você repete. Sem DOM, testado em tests/rotas.test.js.
//
// 1. Cada pedal com GPS vira uma linha reamostrada a cada 50 m.
// 2. Dois pedais são a mesma rota se saem e chegam no mesmo lugar (200 m),
//    têm distância parecida (15%) e 85% de cada caminho fica a menos de 60 m
//    do outro. Ida e volta são rotas diferentes, como no Strava.
// 3. Pedais que se repetem sem rota viram rota nova (automática). As rotas
//    ficam salvas com a linha, para manter nome e histórico.
// 4. GuiaRota acompanha um pedal em andamento: quanto já fez, quanto falta,
//    se saiu do caminho e quantos segundos está à frente ou atrás do melhor.
import { distancia, Projecao } from './geo.js';

export const ROTA = Object.freeze({
  passo: 50,          // m entre pontos da linha
  raioPontas: 200,    // m: saída e chegada no mesmo lugar
  raioCaminho: 60,    // m: ponto conta como "no caminho"
  cobertura: 0.85,    // fração do caminho que precisa bater
  difDist: 0.15,      // diferença de distância aceita
  minDist: 500,       // m: pedal menor que isso não vira rota
  foraDaRota: 80,     // m: longe disso, saiu do caminho
});

const r6 = v => Math.round(v * 1e6) / 1e6;

/** Reamostra [[lat, lon, ...]] a cada `passo` metros ao longo do caminho. */
export function reamostrar(pontos, passo = ROTA.passo) {
  if (!pontos || !pontos.length) return [];
  const out = [[r6(pontos[0][0]), r6(pontos[0][1])]];
  let resto = passo;
  for (let i = 1; i < pontos.length; i++) {
    let aLat = pontos[i - 1][0], aLon = pontos[i - 1][1];
    const bLat = pontos[i][0], bLon = pontos[i][1];
    let d = distancia(aLat, aLon, bLat, bLon);
    while (d >= resto && d > 0) {
      const f = resto / d;
      aLat += (bLat - aLat) * f;
      aLon += (bLon - aLon) * f;
      out.push([r6(aLat), r6(aLon)]);
      d -= resto;
      resto = passo;
    }
    resto -= d;
  }
  const u = pontos[pontos.length - 1];
  if (distancia(out[out.length - 1][0], out[out.length - 1][1], u[0], u[1]) > 1) out.push([r6(u[0]), r6(u[1])]);
  return out;
}

/** Comprimento (m) de uma linha [[lat, lon]]. */
export function comprimento(linha) {
  let d = 0;
  for (let i = 1; i < linha.length; i++) d += distancia(linha[i - 1][0], linha[i - 1][1], linha[i][0], linha[i][1]);
  return d;
}

function distSeg(px, py, ax, ay, bx, by) {
  const dx = bx - ax, dy = by - ay;
  const l2 = dx * dx + dy * dy;
  const t = l2 > 0 ? Math.max(0, Math.min(1, ((px - ax) * dx + (py - ay) * dy) / l2)) : 0;
  return Math.hypot(px - (ax + t * dx), py - (ay + t * dy));
}

/** Fração dos pontos de `a` que ficam a menos de `raio` m da linha `b` (as duas em metros). */
export function cobertura(a, b, raio) {
  if (!a.length || b.length < 2) return 0;
  let ok = 0;
  for (const [px, py] of a) {
    for (let j = 1; j < b.length; j++) {
      if (distSeg(px, py, b[j - 1][0], b[j - 1][1], b[j][0], b[j][1]) <= raio) { ok++; break; }
    }
  }
  return ok / a.length;
}

/** Resumo do caminho de um pedal com GPS, ou null se não serve para rota. */
export function assinatura(pedal, c = ROTA) {
  const pts = pedal && pedal.pontos;
  if (!pts || pedal.via !== 'gps' || pedal.demo || pts.length < 5 || !(pedal.distancia >= c.minDist)) return null;
  const linha = reamostrar(pts, c.passo);
  if (linha.length < 3) return null;
  return { id: pedal.id, inicio: pedal.inicio, linha, dist: pedal.distancia };
}

/** Os dois caminhos (assinatura ou rota salva) são a mesma rota? */
export function mesmoCaminho(a, b, c = ROTA) {
  if (Math.abs(a.dist - b.dist) > c.difDist * Math.max(a.dist, b.dist)) return false;
  const ai = a.linha[0], af = a.linha[a.linha.length - 1], bi = b.linha[0], bf = b.linha[b.linha.length - 1];
  if (distancia(ai[0], ai[1], bi[0], bi[1]) > c.raioPontas || distancia(af[0], af[1], bf[0], bf[1]) > c.raioPontas) return false;
  const proj = new Projecao(ai[0], ai[1]);
  const A = a.linha.map(p => proj.paraXY(p[0], p[1]));
  const B = b.linha.map(p => proj.paraXY(p[0], p[1]));
  return cobertura(A, B, c.raioCaminho) >= c.cobertura && cobertura(B, A, c.raioCaminho) >= c.cobertura;
}

/** Rota nova a partir de um pedal (o primeiro que fez o caminho). */
export function rotaDoPedal(pedal, auto = true, agora = Date.now()) {
  const s = assinatura(pedal);
  if (!s) return null;
  return { id: 'r' + pedal.id, nome: null, linha: s.linha, dist: pedal.distancia, subida: pedal.subida || 0, refId: pedal.id, criada: agora, auto };
}

/**
 * Junta as rotas salvas com o histórico. Cada pedal entra na primeira rota
 * com o mesmo caminho. Pedais repetidos sem rota viram rota automática.
 * Rotas automáticas que ficaram com menos de 2 pedais (pedal apagado) saem.
 * Devolve { rotas, tentativas: {idRota: [idPedal]}, mudou }.
 */
export function organizarRotas(salvas, pedais, c = ROTA, agora = Date.now()) {
  const rotas = (salvas || []).filter(r => r && Array.isArray(r.linha) && r.linha.length >= 3).map(r => ({ ...r }));
  const tent = Object.fromEntries(rotas.map(r => [r.id, []]));
  const sobras = [];
  const sigs = pedais.map(p => assinatura(p, c)).filter(Boolean).sort((a, b) => a.inicio - b.inicio);
  for (const s of sigs) {
    const r = rotas.find(x => mesmoCaminho(x, s, c));
    if (r) tent[r.id].push(s.id);
    else sobras.push(s);
  }
  // Repetidos sem rota: agrupa pelo primeiro de cada caminho
  const grupos = [];
  for (const s of sobras) {
    const g = grupos.find(x => mesmoCaminho(x.ref, s, c));
    if (g) g.membros.push(s.id);
    else grupos.push({ ref: s, membros: [s.id] });
  }
  let mudou = false;
  for (const g of grupos) {
    if (g.membros.length < 2) continue;
    const ref = pedais.find(p => p.id === g.ref.id);
    const r = rotaDoPedal(ref, true, agora);
    if (!r) continue;
    rotas.push(r);
    tent[r.id] = g.membros;
    mudou = true;
  }
  const ficam = rotas.filter(r => !r.auto || r.nome || tent[r.id].length >= 2);
  if (ficam.length !== rotas.length) mudou = true;
  return { rotas: ficam, tentativas: tent, mudou };
}

/** Números de uma rota a partir dos pedais dela: vezes, melhor, média e horários. */
export function estatisticasRota(ids, pedais) {
  const lista = ids.map(id => pedais.find(p => p.id === id)).filter(Boolean).sort((a, b) => a.inicio - b.inicio);
  const tempos = lista.filter(p => p.tempoMov > 0);
  const melhor = tempos.reduce((m, p) => (!m || p.tempoMov < m.tempoMov ? p : m), null);
  const horas = new Array(24).fill(0);
  for (const p of lista) horas[new Date(p.inicio).getHours()]++;
  return {
    vezes: lista.length,
    pedais: lista,
    melhor,
    media: tempos.length ? tempos.reduce((s, p) => s + p.tempoMov, 0) / tempos.length : 0,
    ultima: lista.length ? lista[lista.length - 1] : null,
    horas,
  };
}

/**
 * Tempo em movimento (s) em cada ponto gravado do pedal, descontando as
 * paradas. Devolve [{d (m desde a saída), t (s em movimento)}].
 */
export function curvaTempo(pedal) {
  const pts = pedal.pontos || [];
  const paradas = (pedal.paradas || []).map(p => [p.ini, p.fim ?? Infinity]);
  const parado = t => paradas.reduce((s, [a, b]) => s + Math.max(0, Math.min(t, b) - a), 0);
  const curva = [];
  let d = 0;
  for (let i = 0; i < pts.length; i++) {
    if (i) d += distancia(pts[i - 1][0], pts[i - 1][1], pts[i][0], pts[i][1]);
    curva.push({ d, t: Math.max(0, pts[i][2] - parado(pts[i][2])) });
  }
  // A curva sai com o tempo em movimento final do pedal, para bater com o resumo
  const u = curva[curva.length - 1];
  if (u && u.t > 0 && pedal.tempoMov > 0) { const k = pedal.tempoMov / u.t; for (const p of curva) p.t *= k; }
  return curva;
}

function tempoNaCurva(curva, d) {
  if (!curva.length) return null;
  if (d <= curva[0].d) return curva[0].t;
  for (let i = 1; i < curva.length; i++) {
    if (curva[i].d >= d) {
      const a = curva[i - 1], b = curva[i];
      return b.d > a.d ? a.t + (b.t - a.t) * (d - a.d) / (b.d - a.d) : b.t;
    }
  }
  return curva[curva.length - 1].t;
}

/** Acompanha um pedal em andamento numa rota. */
export class GuiaRota {
  constructor(rota, melhor = null, c = ROTA) {
    this.rota = rota;
    this.c = c;
    this.proj = new Projecao(rota.linha[0][0], rota.linha[0][1]);
    this.xy = rota.linha.map(p => this.proj.paraXY(p[0], p[1]));
    this.acum = [0];
    for (let i = 1; i < this.xy.length; i++) this.acum.push(this.acum[i - 1] + Math.hypot(this.xy[i][0] - this.xy[i - 1][0], this.xy[i][1] - this.xy[i - 1][1]));
    this.total = this.acum[this.acum.length - 1];
    this.i = 0;
    this.feito = 0;
    this.fora = false;
    this.longe = 0;
    this.concluida = false;
    this.melhorTempo = melhor && melhor.tempoMov > 0 ? melhor.tempoMov : null;
    this.curva = melhor && (melhor.pontos || []).length > 2 ? this.#curvaNaRota(melhor) : null;
    this.delta = null;
  }

  /** Tempo do melhor pedal em cada ponto, com a distância medida ao longo da rota (como a do pedal atual). */
  #curvaNaRota(melhor) {
    const tempos = curvaTempo(melhor);
    const g = new GuiaRota(this.rota, null, this.c);
    return melhor.pontos.map((q, i) => { g.atualizar(q[0], q[1], 0); return { d: g.feito, t: tempos[i].t }; });
  }

  /** Posição atual e tempo em movimento do pedal. Devolve eventos: 'saiu', 'voltou', 'concluiu'. */
  atualizar(lat, lon, tempoMov) {
    const ev = [];
    if (this.concluida) return ev;
    const [px, py] = this.proj.paraXY(lat, lon);
    // Procura o trecho mais perto um pouco para trás e bem para frente,
    // para não pular para outra parte da rota onde o caminho se cruza
    const de = Math.max(1, this.i - 3), ate = Math.min(this.xy.length - 1, this.i + 60);
    let melhor = null;
    for (let j = de; j <= ate; j++) {
      const [ax, ay] = this.xy[j - 1], [bx, by] = this.xy[j];
      const dx = bx - ax, dy = by - ay, l2 = dx * dx + dy * dy;
      const t = l2 > 0 ? Math.max(0, Math.min(1, ((px - ax) * dx + (py - ay) * dy) / l2)) : 0;
      const dist = Math.hypot(px - (ax + t * dx), py - (ay + t * dy));
      if (!melhor || dist < melhor.dist) melhor = { j, dist, ao: this.acum[j - 1] + t * Math.sqrt(l2) };
    }
    if (!melhor) return ev;
    this.longe = melhor.dist;
    const fora = melhor.dist > this.c.foraDaRota;
    if (fora !== this.fora) { this.fora = fora; ev.push(fora ? 'saiu' : 'voltou'); }
    if (!fora) {
      this.i = melhor.j;
      this.feito = Math.max(this.feito, melhor.ao);
      if (this.curva) {
        const ref = tempoNaCurva(this.curva, this.feito);
        this.delta = ref == null ? null : tempoMov - ref;
      }
      if (this.total - this.feito <= 30) { this.concluida = true; ev.push('concluiu'); }
    }
    return ev;
  }

  get falta() { return Math.max(0, this.total - this.feito); }
  get fracao() { return this.total > 0 ? Math.min(1, this.feito / this.total) : 0; }
}
