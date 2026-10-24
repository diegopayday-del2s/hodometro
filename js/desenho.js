// Desenho do trajeto (canvas, sem mapa de fundo, funciona offline)
// e do gráfico de velocidade ao longo da distância (SVG).
import { distancia } from './geo.js';
import { km1, kmh } from './formato.js';

const SVG = 'http://www.w3.org/2000/svg';
const cor = (el, nome) => getComputedStyle(el).getPropertyValue(nome).trim();

export function desenharTrajeto(canvas, pedal) {
  const pts = pedal.pontos || [];
  const dpr = globalThis.devicePixelRatio || 1;
  const w = canvas.clientWidth, h = canvas.clientHeight;
  if (!w || !h) return;
  canvas.width = Math.round(w * dpr);
  canvas.height = Math.round(h * dpr);
  const ctx = canvas.getContext('2d');
  ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
  ctx.clearRect(0, 0, w, h);

  const tinta = cor(canvas, '--ink'), suave = cor(canvas, '--muted'), linha = cor(canvas, '--line');
  const rota = cor(canvas, '--accent'), fundo = cor(canvas, '--surface');
  ctx.font = '600 13px "Barlow", system-ui, sans-serif';

  if (pts.length < 2) {
    ctx.fillStyle = suave;
    ctx.textAlign = 'center';
    ctx.fillText(pedal.via === 'manual' ? 'Pedal lançado à mão, sem trajeto' : 'Sem trajeto gravado', w / 2, h / 2);
    return;
  }

  const lat0 = pts[0][0], lon0 = pts[0][1];
  const ky = 111320, kx = ky * Math.cos(lat0 * Math.PI / 180);
  const xy = pts.map(p => [(p[1] - lon0) * kx, (p[0] - lat0) * ky]);
  let minx = Infinity, maxx = -Infinity, miny = Infinity, maxy = -Infinity;
  for (const [x, y] of xy) { minx = Math.min(minx, x); maxx = Math.max(maxx, x); miny = Math.min(miny, y); maxy = Math.max(maxy, y); }
  const pad = 22;
  const larg = Math.max(maxx - minx, 30), alt = Math.max(maxy - miny, 30);
  const esc = Math.min((w - 2 * pad) / larg, (h - 2 * pad - 18) / alt);
  const ox = (w - (maxx - minx) * esc) / 2, oy = (h - 18 - (maxy - miny) * esc) / 2;
  const tela = ([x, y]) => [ox + (x - minx) * esc, h - 18 - (oy + (y - miny) * esc)];

  // Grade leve de 100 m, 500 m ou 1 km
  const passoGrade = [100, 250, 500, 1000, 2500, 5000].find(g => g * esc >= 36) || 10000;
  ctx.strokeStyle = linha; ctx.lineWidth = 1;
  ctx.beginPath();
  for (let gx = Math.ceil(minx / passoGrade) * passoGrade; gx <= maxx; gx += passoGrade) { const [sx] = tela([gx, miny]); ctx.moveTo(sx, 0); ctx.lineTo(sx, h - 18); }
  for (let gy = Math.ceil(miny / passoGrade) * passoGrade; gy <= maxy; gy += passoGrade) { const [, sy] = tela([minx, gy]); ctx.moveTo(0, sy); ctx.lineTo(w, sy); }
  ctx.stroke();

  // Trajeto; trechos sem sinal em tracejado
  const quebras = new Set((pedal.lacunas || []).map(l => l.i));
  ctx.lineJoin = 'round'; ctx.lineCap = 'round';
  for (let i = 1; i < xy.length; i++) {
    const [ax, ay] = tela(xy[i - 1]), [bx, by] = tela(xy[i]);
    const semSinal = quebras.has(i);
    ctx.setLineDash(semSinal ? [4, 6] : []);
    ctx.strokeStyle = semSinal ? suave : rota;
    ctx.lineWidth = semSinal ? 2 : 4;
    ctx.beginPath(); ctx.moveTo(ax, ay); ctx.lineTo(bx, by); ctx.stroke();
  }
  ctx.setLineDash([]);

  const marca = (p, preench, borda) => {
    const [sx, sy] = tela(p);
    ctx.beginPath(); ctx.arc(sx, sy, 7, 0, Math.PI * 2);
    ctx.fillStyle = preench; ctx.fill();
    ctx.lineWidth = 3; ctx.strokeStyle = borda; ctx.stroke();
  };
  marca(xy[0], fundo, tinta);
  marca(xy[xy.length - 1], rota, fundo);

  // Escala
  const alvo = w / 4;
  const metros = [50, 100, 200, 500, 1000, 2000, 5000, 10000, 20000].reduce((m, v) => Math.abs(v * esc - alvo) < Math.abs(m * esc - alvo) ? v : m, 100);
  const px = metros * esc;
  ctx.strokeStyle = tinta; ctx.lineWidth = 2;
  ctx.beginPath(); ctx.moveTo(12, h - 8); ctx.lineTo(12 + px, h - 8); ctx.moveTo(12, h - 12); ctx.lineTo(12, h - 4); ctx.moveTo(12 + px, h - 12); ctx.lineTo(12 + px, h - 4); ctx.stroke();
  ctx.fillStyle = tinta; ctx.textAlign = 'left';
  ctx.fillText(metros >= 1000 ? `${metros / 1000} km` : `${metros} m`, 18 + px, h - 4);
}

/** Velocidade média por faixa de distância, ignorando paradas e trechos sem sinal. */
export function serieVelocidade(pedal) {
  const pts = pedal.pontos || [];
  if (pts.length < 3) return [];
  const quebras = new Set((pedal.lacunas || []).map(l => l.i));
  const segs = [];
  let acum = 0;
  for (let i = 1; i < pts.length; i++) {
    const d = distancia(pts[i - 1][0], pts[i - 1][1], pts[i][0], pts[i][1]);
    const dt = pts[i][2] - pts[i - 1][2];
    acum += d;
    if (!quebras.has(i) && dt > 0 && dt <= 15) segs.push({ meio: acum - d / 2, d, dt });
  }
  if (acum < 200) return [];
  const n = Math.max(10, Math.min(80, Math.round(acum / 100)));
  const b = acum / n;
  const dist = new Array(n).fill(0), tempo = new Array(n).fill(0);
  for (const s of segs) { const k = Math.min(n - 1, Math.floor(s.meio / b)); dist[k] += s.d; tempo[k] += s.dt; }
  const bruto = dist.map((d, k) => (tempo[k] > 0 ? d / tempo[k] : null));
  return bruto.map((v, k) => {
    if (v == null) return { d: (k + 0.5) * b, v: null };
    const viz = [bruto[k - 1], v, bruto[k + 1]].filter(x => x != null);
    return { d: (k + 0.5) * b, v: viz.reduce((a, x) => a + x, 0) / viz.length };
  });
}

const tetoBonito = v => [10, 15, 20, 25, 30, 40, 50, 60, 80, 100].find(x => x >= v) || Math.ceil(v / 20) * 20;

/** Gráfico de área da velocidade (km/h) por distância, com leitura ao tocar. */
export function graficoVelocidade(pedal, leitura) {
  const serie = serieVelocidade(pedal);
  const W = 360, H = 170, esq = 30, dir = 10, topo = 14, base = 24;
  const svg = document.createElementNS(SVG, 'svg');
  svg.setAttribute('viewBox', `0 0 ${W} ${H}`);
  svg.setAttribute('class', 'grafico');
  svg.setAttribute('role', 'img');
  if (!serie.length) {
    svg.setAttribute('aria-label', 'Sem dados suficientes para o gráfico');
    return svg;
  }
  const total = serie[serie.length - 1].d + (serie[1].d - serie[0].d) / 2;
  const maxKmh = tetoBonito(Math.max(...serie.map(s => (s.v || 0) * 3.6)) * 1.05);
  const x = d => esq + d / total * (W - esq - dir);
  const y = kmhV => topo + (1 - kmhV / maxKmh) * (H - topo - base);
  const el = (tag, attrs, texto) => {
    const e = document.createElementNS(SVG, tag);
    for (const k in attrs) e.setAttribute(k, attrs[k]);
    if (texto != null) e.textContent = texto;
    svg.append(e);
    return e;
  };
  svg.setAttribute('aria-label', `Velocidade ao longo de ${km1(total)} km`);

  // Grade e eixos
  for (const v of [0, maxKmh / 2, maxKmh]) {
    el('line', { x1: esq, x2: W - dir, y1: y(v), y2: y(v), class: 'g-grade' });
    el('text', { x: esq - 6, y: y(v) + 4, class: 'g-rotulo', 'text-anchor': 'end' }, String(v).replace('.', ','));
  }
  const kmTotal = total / 1000;
  const passoKm = [0.5, 1, 2, 5, 10, 20, 50].find(p => kmTotal / p <= 6) || 100;
  for (let k = 0; k <= kmTotal + 1e-9; k += passoKm) {
    el('text', { x: x(k * 1000), y: H - 6, class: 'g-rotulo', 'text-anchor': k === 0 ? 'start' : 'middle' }, k === 0 ? '0 km' : String(k).replace('.', ','));
  }

  // Área e linha (com buracos onde não há dado)
  const trechos = [];
  let atual = [];
  for (const s of serie) {
    if (s.v == null) { if (atual.length) trechos.push(atual); atual = []; }
    else atual.push([x(s.d), y(s.v * 3.6)]);
  }
  if (atual.length) trechos.push(atual);
  for (const t of trechos) {
    if (t.length === 1) t.push([t[0][0] + 1, t[0][1]]);
    const linhaD = t.map((p, i) => `${i ? 'L' : 'M'}${p[0].toFixed(1)} ${p[1].toFixed(1)}`).join('');
    el('path', { d: `${linhaD}L${t[t.length - 1][0].toFixed(1)} ${y(0)}L${t[0][0].toFixed(1)} ${y(0)}Z`, class: 'g-area' });
    el('path', { d: linhaD, class: 'g-linha' });
  }

  // Média em movimento
  if (pedal.tempoMov > 0) {
    const m = pedal.distancia / pedal.tempoMov * 3.6;
    el('line', { x1: esq, x2: W - dir, y1: y(m), y2: y(m), class: 'g-media' });
    el('text', { x: W - dir, y: y(m) - 5, class: 'g-rotulo g-rotulo-media', 'text-anchor': 'end' }, `média ${kmh(m / 3.6)}`);
  }

  // Leitura ao tocar ou passar o dedo
  const guia = el('line', { x1: 0, x2: 0, y1: topo, y2: H - base, class: 'g-guia', visibility: 'hidden' });
  const ponto = el('circle', { r: 4.5, class: 'g-ponto', visibility: 'hidden' });
  const mostrar = ev => {
    const r = svg.getBoundingClientRect();
    const px = (ev.clientX - r.left) / r.width * W;
    const d = (px - esq) / (W - esq - dir) * total;
    let melhor = null;
    for (const s of serie) if (s.v != null && (!melhor || Math.abs(s.d - d) < Math.abs(melhor.d - d))) melhor = s;
    if (!melhor) return;
    const gx = x(melhor.d), gy = y(melhor.v * 3.6);
    guia.setAttribute('x1', gx); guia.setAttribute('x2', gx); guia.setAttribute('visibility', 'visible');
    ponto.setAttribute('cx', gx); ponto.setAttribute('cy', gy); ponto.setAttribute('visibility', 'visible');
    if (leitura) leitura.textContent = `km ${km1(melhor.d)}: ${kmh(melhor.v)} km/h`;
  };
  svg.addEventListener('pointermove', mostrar);
  svg.addEventListener('pointerdown', mostrar);
  svg.addEventListener('pointerleave', () => {
    guia.setAttribute('visibility', 'hidden'); ponto.setAttribute('visibility', 'hidden');
    if (leitura) leitura.textContent = 'Toque no gráfico para ver a velocidade em cada trecho.';
  });
  return svg;
}

/** Perfil de elevação ao longo da distância, com dados de altitude suavizados. */
export function serieElevacao(pedal) {
  const pts = pedal.pontos || [];
  if (pts.length < 3) return null;
  const comAlt = pts.filter(p => Number.isFinite(p[3]));
  if (comAlt.length < 4) return null;

  let acum = 0;
  const brutos = [{ d: 0, alt: Number.isFinite(pts[0][3]) ? pts[0][3] : comAlt[0][3] }];
  for (let i = 1; i < pts.length; i++) {
    const d = distancia(pts[i - 1][0], pts[i - 1][1], pts[i][0], pts[i][1]);
    acum += d;
    if (Number.isFinite(pts[i][3])) {
      brutos.push({ d: acum, alt: pts[i][3] });
    }
  }
  if (acum < 150 || brutos.length < 4) return null;

  const total = acum;
  const n = Math.max(12, Math.min(80, Math.round(total / 80)));
  const passo = total / n;
  const serie = [];

  for (let k = 0; k < n; k++) {
    const dAlvo = (k + 0.5) * passo;
    let maisPerto = brutos[0];
    for (const b of brutos) {
      if (Math.abs(b.d - dAlvo) < Math.abs(maisPerto.d - dAlvo)) maisPerto = b;
    }
    serie.push({ d: dAlvo, alt: maisPerto.alt });
  }

  // Média móvel suave de 3 pontos
  const suave = serie.map((s, k) => {
    const viz = [serie[k - 1]?.alt, s.alt, serie[k + 1]?.alt].filter(x => x != null);
    const m = viz.reduce((a, b) => a + b, 0) / viz.length;
    return { d: s.d, alt: Math.round(m * 10) / 10 };
  });

  const alts = suave.map(s => s.alt);
  const minAlt = Math.min(...alts);
  const maxAlt = Math.max(...alts);

  return {
    total,
    pontos: suave,
    minAlt: Math.floor(minAlt),
    maxAlt: Math.ceil(maxAlt),
    variacao: Math.round(maxAlt - minAlt),
    subida: pedal.subida || 0
  };
}

/** Gráfico de área da elevação (altitude em metros) por distância com leitura interativa. */
export function graficoElevacao(pedal, leitura) {
  const dados = serieElevacao(pedal);
  if (!dados || dados.pontos.length < 2) return null;

  const { total, pontos, minAlt, maxAlt } = dados;
  const W = 360, H = 170, esq = 38, dir = 10, topo = 14, base = 24;
  const svg = document.createElementNS(SVG, 'svg');
  svg.setAttribute('viewBox', `0 0 ${W} ${H}`);
  svg.setAttribute('class', 'grafico');
  svg.setAttribute('role', 'img');

  const margemY = Math.max(6, (maxAlt - minAlt) * 0.15);
  const chao = Math.floor(minAlt - margemY);
  const teto = Math.ceil(maxAlt + margemY);
  const rangeY = Math.max(10, teto - chao);

  const x = d => esq + d / total * (W - esq - dir);
  const y = alt => topo + (1 - (alt - chao) / rangeY) * (H - topo - base);

  const el = (tag, attrs, texto) => {
    const e = document.createElementNS(SVG, tag);
    for (const k in attrs) e.setAttribute(k, attrs[k]);
    if (texto != null) e.textContent = texto;
    svg.append(e);
    return e;
  };
  svg.setAttribute('aria-label', `Perfil de elevação de ${minAlt} a ${maxAlt} m`);

  // Linhas de grade e valores no eixo Y
  const passoAlt = [10, 20, 50, 100, 200, 500].find(p => rangeY / p <= 5) || 50;
  const iniY = Math.ceil(chao / passoAlt) * passoAlt;
  for (let a = iniY; a <= teto; a += passoAlt) {
    el('line', { x1: esq, x2: W - dir, y1: y(a), y2: y(a), class: 'g-grade' });
    el('text', { x: esq - 6, y: y(a) + 4, class: 'g-rotulo', 'text-anchor': 'end' }, `${a}m`);
  }

  // Eixo X (quilômetros)
  const kmTotal = total / 1000;
  const passoKm = [0.5, 1, 2, 5, 10, 20, 50].find(p => kmTotal / p <= 6) || 100;
  for (let k = 0; k <= kmTotal + 1e-9; k += passoKm) {
    el('text', { x: x(k * 1000), y: H - 6, class: 'g-rotulo', 'text-anchor': k === 0 ? 'start' : 'middle' }, k === 0 ? '0 km' : String(k).replace('.', ','));
  }

  // Área e contorno da elevação
  const coords = pontos.map(p => [x(p.d), y(p.alt)]);
  const linhaD = coords.map((c, i) => `${i ? 'L' : 'M'}${c[0].toFixed(1)} ${c[1].toFixed(1)}`).join('');
  const areaD = `${linhaD}L${coords[coords.length - 1][0].toFixed(1)} ${y(chao)}L${coords[0][0].toFixed(1)} ${y(chao)}Z`;

  el('path', { d: areaD, class: 'g-area-alt' });
  el('path', { d: linhaD, class: 'g-linha-alt' });

  // Ponto e linha guia de leitura interativa
  const guia = el('line', { x1: 0, x2: 0, y1: topo, y2: H - base, class: 'g-guia', visibility: 'hidden' });
  const ponto = el('circle', { r: 4.5, class: 'g-ponto-alt', visibility: 'hidden' });

  const mostrar = ev => {
    const r = svg.getBoundingClientRect();
    const px = (ev.clientX - r.left) / r.width * W;
    const d = (px - esq) / (W - esq - dir) * total;
    let melhor = null;
    for (const p of pontos) {
      if (!melhor || Math.abs(p.d - d) < Math.abs(melhor.d - d)) melhor = p;
    }
    if (!melhor) return;
    const gx = x(melhor.d), gy = y(melhor.alt);
    guia.setAttribute('x1', gx); guia.setAttribute('x2', gx); guia.setAttribute('visibility', 'visible');
    ponto.setAttribute('cx', gx); ponto.setAttribute('cy', gy); ponto.setAttribute('visibility', 'visible');
    const diff = Math.round(melhor.alt - pontos[0].alt);
    const diffTxt = diff >= 0 ? `+${diff}` : `${diff}`;
    if (leitura) leitura.textContent = `km ${km1(melhor.d)}: ${Math.round(melhor.alt)} m (${diffTxt} m)`;
  };

  svg.addEventListener('pointermove', mostrar);
  svg.addEventListener('pointerdown', mostrar);
  svg.addEventListener('pointerleave', () => {
    guia.setAttribute('visibility', 'hidden'); ponto.setAttribute('visibility', 'hidden');
    if (leitura) leitura.textContent = 'Toque no gráfico para ver a altitude em cada trecho.';
  });

  return svg;
}
