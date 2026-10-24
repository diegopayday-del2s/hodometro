// Imagem do pedal para os stories (1080 x 1920): distância, subida e tempo
// em cima, o desenho do trajeto embaixo e o nome do app. Três modelos:
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
