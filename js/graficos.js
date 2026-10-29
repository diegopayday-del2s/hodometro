// Gráficos em SVG: progresso com comparação, horas de atividade e anel de meta.
import { h } from './ui.js';
import { MESES } from './formato.js';

const MES3 = MESES.map(m => m.slice(0, 3).toUpperCase());
// Teto do eixo cuja metade também é um número redondo (5, 15, 60...)
const tetoBonito = v => {
  if (v <= 0) return 1;
  const p = 10 ** Math.floor(Math.log10(v));
  return [1, 1.2, 1.6, 2, 3, 4, 5, 6, 8, 10].map(k => k * p).find(x => x >= v - 1e-9);
};
const rotuloEixo = v => (Number.isInteger(Math.round(v * 1000) / 1000) ? String(Math.round(v)) : String(Math.round(v * 10) / 10).replace('.', ','));

/**
 * Linha do período atual (laranja, com área) e do anterior (azul), faixa a faixa.
 * pg: saída de progresso(). conv: valor do motor → número exibido. unid: "km", "h", "m".
 * leitura: elemento que mostra o valor da faixa tocada.
 */
export function graficoProgresso(pg, { comparar = true, conv = v => v, unid = '', fmt = v => String(v), leitura = null } = {}) {
  const W = 360, H = 210, esq = 8, dir = 50, topo = 16, base = 26;
  const n = pg.atual.length;
  const atual = pg.atual.map(f => conv(f.valor)), ant = pg.anterior.map(f => conv(f.valor));
  const teto = tetoBonito(Math.max(...atual, ...(comparar ? ant : [0]), 0) * 1.05);
  const X = i => esq + (n > 1 ? i * (W - esq - dir) / (n - 1) : (W - esq - dir) / 2);
  const Y = v => topo + (1 - v / teto) * (H - topo - base);
  const svg = h('svg', { viewBox: `0 0 ${W} ${H}`, class: 'grafico', role: 'img', 'aria-label': `Gráfico de ${n} faixas` });
  for (const v of [0, teto / 2, teto]) {
    svg.append(h('line', { class: 'g-grade', x1: esq, x2: W - dir + 4, y1: Y(v), y2: Y(v) }));
    svg.append(h('text', { class: 'g-rotulo', x: W - dir + 8, y: Y(v) + 4, text: `${rotuloEixo(v)} ${unid}` }));
  }
  // Rótulos dos meses
  let mesAnt = -1;
  pg.atual.forEach((f, i) => {
    const d = new Date(f.ini), m = d.getMonth();
    const passo = pg.periodo === 'ano' ? i % 2 === 0 : m !== mesAnt;
    if (passo) svg.append(h('text', { class: 'g-rotulo', x: X(i), y: H - 6, 'text-anchor': i === 0 ? 'start' : 'middle', text: MES3[m] }));
    mesAnt = m;
  });
  const caminho = vals => vals.map((v, i) => `${i ? 'L' : 'M'}${X(i).toFixed(1)},${Y(v).toFixed(1)}`).join('');
  svg.append(h('path', { class: 'g-area', d: `${caminho(atual)}L${X(n - 1)},${Y(0)}L${X(0)},${Y(0)}Z` }));
  if (comparar) {
    svg.append(h('path', { class: 'g-linha2', d: caminho(ant) }));
    ant.forEach((v, i) => svg.append(h('circle', { class: 'g-ponto2', cx: X(i), cy: Y(v), r: 3.6 })));
  }
  svg.append(h('path', { class: 'g-linha', d: caminho(atual) }));
  atual.forEach((v, i) => svg.append(h('circle', { class: 'g-ponto', cx: X(i), cy: Y(v), r: 3.6 })));
  // Toque: mostra a faixa
  const guia = h('line', { class: 'g-guia', x1: 0, x2: 0, y1: topo, y2: H - base, visibility: 'hidden' });
  svg.append(guia);
  const passo = n > 1 ? (W - esq - dir) / (n - 1) : W;
  pg.atual.forEach((f, i) => {
    svg.append(h('rect', {
      x: X(i) - passo / 2, y: 0, width: passo, height: H, fill: 'transparent',
      onclick: () => {
        guia.setAttribute('x1', X(i)); guia.setAttribute('x2', X(i)); guia.setAttribute('visibility', 'visible');
        if (!leitura) return;
        const d = new Date(f.ini);
        const quando = pg.periodo === 'ano' ? `${MESES[d.getMonth()]} de ${d.getFullYear()}` : `Semana de ${String(d.getDate()).padStart(2, '0')}/${String(d.getMonth() + 1).padStart(2, '0')}`;
        leitura.textContent = `${quando}: ${fmt(atual[i])} ${unid}${comparar ? ` (período anterior: ${fmt(ant[i])} ${unid})` : ''}`;
      },
    }));
  });
  return svg;
}

/** Barras dos horários em que você saiu (0 a 23 h). A hora de agora fica em laranja. */
export function histogramaHoras(horas, agora = new Date().getHours()) {
  const com = horas.map((v, i) => (v ? i : -1)).filter(i => i >= 0);
  const ini = Math.max(0, Math.min(5, (com[0] ?? 6) - 1)), fim = Math.min(23, Math.max(21, (com[com.length - 1] ?? 20) + 1));
  const n = fim - ini + 1;
  const W = 360, H = 130, base = 20, topo = 8;
  const max = Math.max(1, ...horas);
  const larg = W / n;
  const svg = h('svg', { viewBox: `0 0 ${W} ${H}`, class: 'grafico horas', role: 'img', 'aria-label': 'Horários em que você pedala esta rota' });
  for (let k = 0; k < n; k++) {
    const hora = ini + k;
    const v = horas[hora];
    const alt = v ? Math.max(6, v / max * (H - base - topo)) : 3;
    svg.append(h('rect', { class: hora === agora ? 'g-barra agora' : 'g-barra', x: k * larg + 2, y: H - base - alt, width: larg - 4, height: alt, rx: 2 }));
    if (hora % 3 === 0) svg.append(h('text', { class: 'g-rotulo', x: k * larg + larg / 2, y: H - 5, 'text-anchor': 'middle', text: `${hora}h` }));
  }
  return svg;
}

/** Anel de progresso de uma meta. */
export function anel(fracao, batida = false) {
  const r = 26, c = 2 * Math.PI * r;
  const f = Math.max(0, Math.min(1, fracao || 0));
  return h('svg', { viewBox: '0 0 64 64', class: 'anel' + (batida ? ' batida' : ''), 'aria-hidden': 'true' },
    h('circle', { class: 'anel-fundo', cx: 32, cy: 32, r }),
    h('circle', { class: 'anel-feito', cx: 32, cy: 32, r, 'stroke-dasharray': `${(f * c).toFixed(1)} ${c.toFixed(1)}`, transform: 'rotate(-90 32 32)' }));
}

// ---------- rendimento desde o começo ----------

const dm = t => { const d = new Date(t); return `${String(d.getDate()).padStart(2, '0')}/${String(d.getMonth() + 1).padStart(2, '0')}`; };
const kmTxt = m => String(Math.round(m / 100) / 10).replace('.', ',');

/** Toque numa faixa do gráfico: mostra a guia e escreve a leitura. */
function tocavel(svg, xs, H, topo, base, aoTocar) {
  const guia = h('line', { class: 'g-guia', x1: 0, x2: 0, y1: topo, y2: H - base, visibility: 'hidden' });
  svg.append(guia);
  xs.forEach((x, i) => {
    const esq = i ? (xs[i - 1] + x) / 2 : x - 20, dir = i < xs.length - 1 ? (x + xs[i + 1]) / 2 : x + 20;
    svg.append(h('rect', {
      x: esq, y: 0, width: Math.max(1, dir - esq), height: H, fill: 'transparent',
      onclick: () => { guia.setAttribute('x1', x); guia.setAttribute('x2', x); guia.setAttribute('visibility', 'visible'); aoTocar(i); },
    }));
  });
}

/** Distância somada desde o primeiro pedal (km), em área laranja. acumulado: [{t, v (m)}]. */
export function graficoAcumulado(acumulado, { leitura = null } = {}) {
  const W = 360, H = 180, esq = 8, dir = 50, topo = 14, base = 24;
  const t0 = acumulado[0].t, t1 = acumulado[acumulado.length - 1].t;
  const teto = tetoBonito(acumulado[acumulado.length - 1].v / 1000 * 1.05);
  const X = t => esq + (t1 > t0 ? (t - t0) / (t1 - t0) : 0.5) * (W - esq - dir);
  const Y = km => topo + (1 - km / teto) * (H - topo - base);
  const svg = h('svg', { viewBox: `0 0 ${W} ${H}`, class: 'grafico', role: 'img', 'aria-label': 'Distância somada desde o primeiro pedal' });
  for (const v of [0, teto / 2, teto]) {
    svg.append(h('line', { class: 'g-grade', x1: esq, x2: W - dir + 4, y1: Y(v), y2: Y(v) }));
    svg.append(h('text', { class: 'g-rotulo', x: W - dir + 8, y: Y(v) + 4, text: `${rotuloEixo(v)} km` }));
  }
  svg.append(h('text', { class: 'g-rotulo', x: esq, y: H - 6, text: dm(t0) }));
  svg.append(h('text', { class: 'g-rotulo', x: W - dir, y: H - 6, 'text-anchor': 'end', text: 'hoje' }));
  const linha = acumulado.map((p, i) => `${i ? 'L' : 'M'}${X(p.t).toFixed(1)},${Y(p.v / 1000).toFixed(1)}`).join('');
  svg.append(h('path', { class: 'g-area', d: `${linha}L${X(t1).toFixed(1)},${Y(0)}L${X(t0).toFixed(1)},${Y(0)}Z` }));
  svg.append(h('path', { class: 'g-linha', d: linha }));
  const dias = acumulado.slice(1).filter((p, i) => p.v > acumulado[i].v);
  dias.forEach(p => svg.append(h('circle', { class: 'g-ponto', cx: X(p.t), cy: Y(p.v / 1000), r: 3.4 })));
  if (leitura && dias.length) tocavel(svg, dias.map(p => X(p.t)), H, topo, base, i => { leitura.textContent = `Até ${dm(dias[i].t)}: ${kmTxt(dias[i].v)} km somados.`; });
  return svg;
}

/**
 * Velocidade média de cada pedal (pontos laranja) e a tendência (tracejado).
 * evolucao: [{inicio, vel (m/s), dist}]; tendencia: {de, para} ou null.
 */
export function graficoEvolucao(evolucao, tendencia, { leitura = null } = {}) {
  const W = 360, H = 180, esq = 8, dir = 58, topo = 14, base = 24;
  const kmh = v => v * 3.6;
  const vals = evolucao.map(e => kmh(e.vel));
  const lo = Math.max(0, Math.floor((Math.min(...vals) - 1) / 2) * 2), hi = Math.ceil((Math.max(...vals) + 1) / 2) * 2;
  const n = evolucao.length;
  const X = i => esq + (n > 1 ? i / (n - 1) : 0.5) * (W - esq - dir);
  const Y = v => topo + (1 - (v - lo) / Math.max(1, hi - lo)) * (H - topo - base);
  const svg = h('svg', { viewBox: `0 0 ${W} ${H}`, class: 'grafico', role: 'img', 'aria-label': 'Velocidade média de cada pedal' });
  for (const v of [lo, (lo + hi) / 2, hi]) {
    svg.append(h('line', { class: 'g-grade', x1: esq, x2: W - dir + 4, y1: Y(v), y2: Y(v) }));
    svg.append(h('text', { class: 'g-rotulo', x: W - dir + 8, y: Y(v) + 4, text: `${rotuloEixo(v)} km/h` }));
  }
  svg.append(h('text', { class: 'g-rotulo', x: esq, y: H - 6, text: dm(evolucao[0].inicio) }));
  if (n > 1) svg.append(h('text', { class: 'g-rotulo', x: X(n - 1), y: H - 6, 'text-anchor': 'end', text: dm(evolucao[n - 1].inicio) }));
  if (n > 1) svg.append(h('path', { class: 'g-linha fina', d: vals.map((v, i) => `${i ? 'L' : 'M'}${X(i).toFixed(1)},${Y(v).toFixed(1)}`).join('') }));
  if (tendencia) svg.append(h('line', { class: 'g-tendencia', x1: X(0), y1: Y(kmh(tendencia.de)), x2: X(n - 1), y2: Y(kmh(tendencia.para)) }));
  vals.forEach((v, i) => svg.append(h('circle', { class: 'g-ponto', cx: X(i), cy: Y(v), r: 4 })));
  if (leitura) tocavel(svg, vals.map((_, i) => X(i)), H, topo, base, i => {
    const e = evolucao[i];
    leitura.textContent = `Pedal ${i + 1}, ${dm(e.inicio)}: ${String(Math.round(vals[i] * 10) / 10).replace('.', ',')} km/h em ${kmTxt(e.dist)} km.`;
  });
  return svg;
}

/** Km de cada semana desde a primeira; a semana de agora em laranja forte. */
export function barrasSemanas(semanas, { leitura = null } = {}) {
  const lista = semanas.slice(-26);
  const W = 360, H = 150, esq = 4, dir = 46, topo = 10, base = 22;
  const teto = tetoBonito(Math.max(...lista.map(w => w.distancia / 1000), 0.1) * 1.05);
  const n = lista.length;
  const larg = (W - esq - dir) / n;
  const Y = km => topo + (1 - km / teto) * (H - topo - base);
  const svg = h('svg', { viewBox: `0 0 ${W} ${H}`, class: 'grafico', role: 'img', 'aria-label': 'Distância de cada semana' });
  for (const v of [0, teto / 2, teto]) {
    svg.append(h('line', { class: 'g-grade', x1: esq, x2: W - dir + 4, y1: Y(v), y2: Y(v) }));
    svg.append(h('text', { class: 'g-rotulo', x: W - dir + 8, y: Y(v) + 4, text: `${rotuloEixo(v)} km` }));
  }
  const passoRot = Math.max(1, Math.ceil(n / 6));
  lista.forEach((w, i) => {
    const km = w.distancia / 1000;
    const alt = km > 0 ? Math.max(3, Y(0) - Y(km)) : 0;
    const x = esq + i * larg;
    // Poucas semanas: barra de no máximo 40 de largura, centrada
    const lb = Math.min(40, Math.max(2, larg - 2 * Math.min(3, larg * 0.15)));
    if (alt) svg.append(h('rect', { class: i === n - 1 ? 'g-barra-km agora' : 'g-barra-km', x: x + (larg - lb) / 2, y: Y(0) - alt, width: lb, height: alt, rx: 2 }));
    if ((n - 1 - i) % passoRot === 0) svg.append(h('text', { class: 'g-rotulo', x: x + larg / 2, y: H - 6, 'text-anchor': 'middle', text: i === n - 1 ? 'agora' : dm(w.ini) }));
  });
  if (leitura) tocavel(svg, lista.map((_, i) => esq + i * larg + larg / 2), H, topo, base, i => {
    const w = lista[i];
    leitura.textContent = `Semana de ${dm(w.ini)}: ${kmTxt(w.distancia)} km em ${w.n} ${w.n === 1 ? 'pedal' : 'pedais'}.`;
  });
  return svg;
}
