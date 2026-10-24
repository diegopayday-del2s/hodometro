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
