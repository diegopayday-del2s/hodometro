// Imagem do pedal para os stories (1080 x 1920): distância, subida e tempo
// em cima, o desenho do trajeto embaixo e o nome do app. Também a imagem do
// rendimento desde o começo (desenharStoryRendimento). Três modelos:
//   laranja       fundo laranja chapado
//   foto          uma foto da galeria, escurecida para o texto aparecer
//   transparente  só o texto e o trajeto, para colar por cima de uma foto no Instagram
import * as F from './formato.js';

export const LARG = 1080, ALT = 1920;
const LARANJA = '#fc5200';

/** "1h 30m", "24m 10s" ou "45s", como nos stories. */
export const tempoStory = F.tempoCurto;

/** Os números que vão na imagem (até 3), na ordem do Strava. */
export function numerosStory(p) {
  const n = [{ rotulo: 'Distância', valor: `${F.km2(p.distancia)} km` }];
  if (p.via !== 'manual' && p.subida > 0) n.push({ rotulo: 'Ganho de elevação', valor: `${F.inteiro(p.subida)} m` });
  if (p.tempoMov > 0) n.push({ rotulo: 'Tempo', valor: tempoStory(p.tempoMov) });
  if (n.length < 3 && p.tempoMov > 0) n.push({ rotulo: 'Velocidade média', valor: `${F.kmh(p.distancia / p.tempoMov)} km/h` });
  return n.slice(0, 3);
}

function desenharTrajeto(ctx, pontos, caixa, cor) {
  if (!pontos || pontos.length < 2) return;
  const lat0 = pontos[0][0];
  const kx = Math.cos(lat0 * Math.PI / 180);
  const xy = pontos.map(p => [p[1] * kx, -p[0]]);
  let minx = Infinity, maxx = -Infinity, miny = Infinity, maxy = -Infinity;
  for (const [x, y] of xy) { minx = Math.min(minx, x); maxx = Math.max(maxx, x); miny = Math.min(miny, y); maxy = Math.max(maxy, y); }
  const esc = Math.min(caixa.w / Math.max(maxx - minx, 1e-6), caixa.h / Math.max(maxy - miny, 1e-6));
  const ox = caixa.x + (caixa.w - (maxx - minx) * esc) / 2, oy = caixa.y + (caixa.h - (maxy - miny) * esc) / 2;
  ctx.beginPath();
  xy.forEach(([x, y], i) => { const a = ox + (x - minx) * esc, b = oy + (y - miny) * esc; if (i) ctx.lineTo(a, b); else ctx.moveTo(a, b); });
  ctx.lineJoin = 'round'; ctx.lineCap = 'round';
  ctx.lineWidth = 16; ctx.strokeStyle = cor; ctx.stroke();
}

function capa(ctx, img) {
  const k = Math.max(LARG / img.width, ALT / img.height);
  const w = img.width * k, h = img.height * k;
  ctx.drawImage(img, (LARG - w) / 2, (ALT - h) / 2, w, h);
}

/** Fundo do modelo. Devolve a cor do traço e se o texto precisa de sombra. */
function fundo(ctx, modelo, foto) {
  ctx.clearRect(0, 0, LARG, ALT);
  if (modelo === 'laranja') {
    ctx.fillStyle = LARANJA; ctx.fillRect(0, 0, LARG, ALT);
    const g = ctx.createRadialGradient(LARG * 0.5, ALT * 0.28, 50, LARG * 0.5, ALT * 0.28, ALT * 0.8);
    g.addColorStop(0, 'rgba(255,255,255,.14)'); g.addColorStop(1, 'rgba(0,0,0,.10)');
    ctx.fillStyle = g; ctx.fillRect(0, 0, LARG, ALT);
    return { traco: '#ffffff', sombra: false };
  }
  if (modelo === 'foto') {
    if (foto) capa(ctx, foto);
    else { ctx.fillStyle = '#1f1f24'; ctx.fillRect(0, 0, LARG, ALT); }
    const g = ctx.createLinearGradient(0, 0, 0, ALT);
    g.addColorStop(0, 'rgba(0,0,0,.55)'); g.addColorStop(0.55, 'rgba(0,0,0,.25)'); g.addColorStop(1, 'rgba(0,0,0,.55)');
    ctx.fillStyle = g; ctx.fillRect(0, 0, LARG, ALT);
  }
  return { traco: LARANJA, sombra: true };
}

function marcaApp(ctx, nome, sombra) {
  if (sombra) { ctx.shadowColor = 'rgba(0,0,0,.45)'; ctx.shadowBlur = 18; }
  ctx.fillStyle = '#ffffff';
  ctx.textAlign = 'center';
  ctx.font = '800 76px Barlow, system-ui, sans-serif';
  ctx.letterSpacing = '6px';
  ctx.fillText(nome.toUpperCase(), LARG / 2, 1740);
  ctx.letterSpacing = '0px';
  ctx.shadowColor = 'transparent';
}

/** Os números do rendimento que vão na imagem. `rd`: saída de rendimento(). */
export function numerosRendimento(rd) {
  const n = [
    { rotulo: 'Distância', valor: `${F.km1(rd.total.distancia)} km` },
    { rotulo: 'Pedais', valor: F.inteiro(rd.n) },
    { rotulo: 'Tempo pedalando', valor: F.tempoCurto(rd.total.tempoMov) },
  ];
  let destaque = null;
  if (rd.velocidade && rd.velocidade.variacao >= 0.02) destaque = `Média ${Math.round(rd.velocidade.variacao * 100)}% mais rápida`;
  else if (rd.distancia && rd.distancia.variacao >= 0.05) destaque = `Pedais ${Math.round(rd.distancia.variacao * 100)}% mais longos`;
  else if (rd.semanasSeguidas >= 2) destaque = `${rd.semanasSeguidas} semanas seguidas`;
  else if (rd.total.velMedia > 0) destaque = `Média de ${F.kmh(rd.total.velMedia)} km/h`;
  return { numeros: n, destaque };
}

/** Imagem do rendimento desde o começo, com a linha da distância somada. */
export async function desenharStoryRendimento(canvas, rd, { modelo = 'laranja', foto = null, nome = 'Hodômetro' } = {}) {
  try { await Promise.all(['800 140px Barlow', '600 44px Barlow'].map(f => document.fonts.load(f))); } catch { /* usa a fonte que tiver */ }
  canvas.width = LARG; canvas.height = ALT;
  const ctx = canvas.getContext('2d');
  const { traco, sombra } = fundo(ctx, modelo, foto);
  const d = new Date(rd.inicio);
  ctx.textAlign = 'center';
  if (sombra) { ctx.shadowColor = 'rgba(0,0,0,.45)'; ctx.shadowBlur = 18; ctx.shadowOffsetY = 3; }
  ctx.fillStyle = '#ffffff';
  ctx.font = '700 48px Barlow, system-ui, sans-serif';
  ctx.letterSpacing = '4px';
  ctx.fillText('MEU RENDIMENTO', LARG / 2, 250);
  ctx.letterSpacing = '0px';
  ctx.font = '600 44px Barlow, system-ui, sans-serif';
  ctx.fillText(`desde ${F.diaMes(d)}/${d.getFullYear()} · ${rd.dias} ${rd.dias === 1 ? 'dia' : 'dias'}`, LARG / 2, 320);
  const { numeros, destaque } = numerosRendimento(rd);
  let y = 470;
  for (const n of numeros) {
    ctx.font = '600 46px Barlow, system-ui, sans-serif';
    ctx.fillText(n.rotulo, LARG / 2, y);
    ctx.font = '800 136px Barlow, system-ui, sans-serif';
    ctx.fillText(n.valor, LARG / 2, y + 140);
    y += 270;
  }
  if (destaque) {
    ctx.font = '800 58px Barlow, system-ui, sans-serif';
    ctx.fillText(destaque, LARG / 2, y + 30);
  }
  ctx.shadowColor = 'transparent';
  // Linha da distância somada
  const ac = rd.acumulado || [];
  if (ac.length >= 2) {
    const caixa = { x: 170, y: 1380, w: 740, h: 230 };
    const t0 = ac[0].t, t1 = ac[ac.length - 1].t, max = Math.max(1, ac[ac.length - 1].v);
    if (sombra) { ctx.shadowColor = 'rgba(0,0,0,.35)'; ctx.shadowBlur = 14; }
    ctx.beginPath();
    ac.forEach((p, i) => {
      const x = caixa.x + (t1 > t0 ? (p.t - t0) / (t1 - t0) : 0.5) * caixa.w, yy = caixa.y + (1 - p.v / max) * caixa.h;
      if (i) ctx.lineTo(x, yy); else ctx.moveTo(x, yy);
    });
    ctx.lineJoin = 'round'; ctx.lineCap = 'round';
    ctx.lineWidth = 14; ctx.strokeStyle = traco; ctx.stroke();
    ctx.shadowColor = 'transparent';
  }
  marcaApp(ctx, nome, sombra);
  return canvas;
}

/**
 * Desenha a imagem no canvas (1080 x 1920).
 * opcoes: { modelo, foto (imagem carregada, para o modelo foto), nome (do app) }
 */
export async function desenharStory(canvas, pedal, { modelo = 'laranja', foto = null, nome = 'Hodômetro' } = {}) {
  try { await Promise.all(['800 140px Barlow', '600 44px Barlow'].map(f => document.fonts.load(f))); } catch { /* usa a fonte que tiver */ }
  canvas.width = LARG; canvas.height = ALT;
  const ctx = canvas.getContext('2d');
  ctx.clearRect(0, 0, LARG, ALT);
  let corTrajeto = LARANJA;
  const sombra = modelo !== 'laranja';
  if (modelo === 'laranja') {
    ctx.fillStyle = LARANJA; ctx.fillRect(0, 0, LARG, ALT);
    const g = ctx.createRadialGradient(LARG * 0.5, ALT * 0.28, 50, LARG * 0.5, ALT * 0.28, ALT * 0.8);
    g.addColorStop(0, 'rgba(255,255,255,.14)'); g.addColorStop(1, 'rgba(0,0,0,.10)');
    ctx.fillStyle = g; ctx.fillRect(0, 0, LARG, ALT);
    corTrajeto = '#ffffff';
  } else if (modelo === 'foto') {
    if (foto) capa(ctx, foto);
    else { ctx.fillStyle = '#1f1f24'; ctx.fillRect(0, 0, LARG, ALT); }
    const g = ctx.createLinearGradient(0, 0, 0, ALT);
    g.addColorStop(0, 'rgba(0,0,0,.55)'); g.addColorStop(0.55, 'rgba(0,0,0,.25)'); g.addColorStop(1, 'rgba(0,0,0,.55)');
    ctx.fillStyle = g; ctx.fillRect(0, 0, LARG, ALT);
  }
  ctx.textAlign = 'center';
  ctx.textBaseline = 'alphabetic';
  if (sombra) { ctx.shadowColor = 'rgba(0,0,0,.45)'; ctx.shadowBlur = 18; ctx.shadowOffsetY = 3; }
  ctx.fillStyle = '#ffffff';
  const nums = numerosStory(pedal);
  let y = nums.length === 3 ? 470 : 560;
  for (const n of nums) {
    ctx.font = '600 46px Barlow, system-ui, sans-serif';
    ctx.fillText(n.rotulo, LARG / 2, y);
    ctx.font = '800 136px Barlow, system-ui, sans-serif';
    ctx.fillText(n.valor, LARG / 2, y + 140);
    y += 290;
  }
  ctx.shadowColor = 'transparent';
  const pts = (pedal.pontos || []).length > 1 ? pedal.pontos : null;
  if (pts) {
    if (sombra) { ctx.shadowColor = 'rgba(0,0,0,.35)'; ctx.shadowBlur = 14; }
    desenharTrajeto(ctx, pts, { x: 300, y: Math.max(y - 40, 1250), w: 480, h: 360 }, corTrajeto);
    ctx.shadowColor = 'transparent';
  }
  if (sombra) { ctx.shadowColor = 'rgba(0,0,0,.45)'; ctx.shadowBlur = 18; }
  ctx.fillStyle = '#ffffff';
  ctx.font = '800 76px Barlow, system-ui, sans-serif';
  const marca = nome.toUpperCase();
  ctx.letterSpacing = '6px';
  ctx.fillText(marca, LARG / 2, 1740);
  ctx.letterSpacing = '0px';
  ctx.shadowColor = 'transparent';
  return canvas;
}

/** PNG da imagem em base64 (sem o prefixo data:). */
export function pngBase64(canvas) {
  return canvas.toDataURL('image/png').split(',')[1];
}
