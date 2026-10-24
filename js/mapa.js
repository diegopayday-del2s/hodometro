// Mapa de fundo atrás do trajeto: blocos do OpenStreetMap.
// Só aparece com internet. Sem ela, ou se algum bloco não carregar, a função
// devolve false e fica o desenho de sempre (desenho.js).
// A gravação do pedal nunca depende disto.
// Regras de uso dos blocos (operations.osmfoundation.org/policies/tiles):
// atribuição visível, cada bloco pedido uma vez só (o Map `blocos` guarda) e o
// app se identifica (appendUserAgent em capacitor.config.json).

const TAM = 256;
const ZOOM_MAX = 17;
const ESPERA = 6000;   // ms para os blocos chegarem
const ATRIBUICAO = '© colaboradores do OpenStreetMap';
const url = (z, x, y) => `https://tile.openstreetmap.org/${z}/${x}/${y}.png`;

const px = (lon, z) => (lon + 180) / 360 * TAM * 2 ** z;
const py = (lat, z) => {
  const s = Math.sin(lat * Math.PI / 180);
  return (0.5 - Math.log((1 + s) / (1 - s)) / (4 * Math.PI)) * TAM * 2 ** z;
};

const blocos = new Map();   // url → Promise<Image>, enquanto o app está aberto
function bloco(u) {
  if (!blocos.has(u)) {
    blocos.set(u, new Promise((ok, erro) => {
      const img = new Image();
      img.crossOrigin = 'anonymous';
      img.decoding = 'async';
      img.onload = () => ok(img);
      img.onerror = () => { blocos.delete(u); erro(new Error('bloco')); };
      img.src = u;
    }));
  }
  return blocos.get(u);
}

const esperar = (p, ms) => Promise.race([p, new Promise((_, erro) => setTimeout(() => erro(new Error('demorou')), ms))]);

export const podeUsarMapa = () => typeof navigator === 'undefined' || navigator.onLine !== false;

/** Tamanho do canvas na tela; null se ainda não aparece. */
function preparar(canvas) {
  const dpr = globalThis.devicePixelRatio || 1;
  const w = canvas.clientWidth, h = canvas.clientHeight;
  if (!w || !h) return null;
  return { w, h, dpr };
}

/**
 * Desenha os blocos que cobrem a janela centrada em (cx, cy) no zoom `z` com
 * escala `esc`. Só pinta no canvas quando todos chegaram.
 */
async function pintarBlocos(canvas, z, cx, cy, esc, tela, depois, vale = () => true) {
  const { w, h, dpr } = tela;
  const lado = TAM * esc;
  const x0 = Math.floor((cx - w / 2 / esc) / TAM), x1 = Math.floor((cx + w / 2 / esc) / TAM);
  const y0 = Math.floor((cy - h / 2 / esc) / TAM), y1 = Math.floor((cy + h / 2 / esc) / TAM);
  const n = 2 ** z;
  const pedidos = [];
  for (let x = x0; x <= x1; x++) for (let y = y0; y <= y1; y++) {
    if (y < 0 || y >= n) continue;
    const xx = ((x % n) + n) % n;
    pedidos.push(bloco(url(z, xx, y)).then(img => ({ img, x, y })));
  }
  const imgs = await esperar(Promise.all(pedidos), ESPERA);
  // Outro desenho começou depois deste: não pinta por cima
  if (!vale()) return false;
  canvas.width = Math.round(w * dpr);
  canvas.height = Math.round(h * dpr);
  const ctx = canvas.getContext('2d');
  ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
  for (const { img, x, y } of imgs) {
    ctx.drawImage(img, w / 2 + (x * TAM - cx) * esc, h / 2 + (y * TAM - cy) * esc, lado + 0.5, lado + 0.5);
  }
  const tela2 = (lat, lon) => [w / 2 + (px(lon, z) - cx) * esc, h / 2 + (py(lat, z) - cy) * esc];
  depois(ctx, tela2);
  // Atribuição pedida pelos dados do mapa
  ctx.font = '500 10px "Barlow", system-ui, sans-serif';
  const tw = ctx.measureText(ATRIBUICAO).width;
  ctx.fillStyle = 'rgba(255,255,255,.85)';
  ctx.fillRect(w - tw - 10, h - 16, tw + 10, 16);
  ctx.fillStyle = '#555';
  ctx.textAlign = 'left';
  ctx.fillText(ATRIBUICAO, w - tw - 5, h - 4.5);
  return true;
}

/**
 * Trajeto do pedal (ou linha de rota) sobre o mapa. pontos: [[lat, lon, ...]].
 * lacunas: índices onde começa um trecho sem sinal (tracejado).
 * Devolve true se desenhou com mapa.
 */
export async function trajetoNoMapa(canvas, pontos, { lacunas = [], cor = '#fc5200', margem = 28, rota = null } = {}) {
  if (!podeUsarMapa() || !pontos || pontos.length < 2) return false;
  const tela = preparar(canvas);
  if (!tela) return false;
  const marca = (canvas.dataset.mapa = String(Math.random()));
  // rota: linha da rota que está sendo seguida, desenhada por baixo do trajeto
  const guia = rota && rota.length >= 2 ? rota : [];
  let minLat = Infinity, maxLat = -Infinity, minLon = Infinity, maxLon = -Infinity;
  for (const p of [...pontos, ...guia]) { minLat = Math.min(minLat, p[0]); maxLat = Math.max(maxLat, p[0]); minLon = Math.min(minLon, p[1]); maxLon = Math.max(maxLon, p[1]); }
  const larg0 = Math.max(px(maxLon, 0) - px(minLon, 0), 1e-7), alt0 = Math.max(py(minLat, 0) - py(maxLat, 0), 1e-7);
  const zFit = Math.log2(Math.min((tela.w - 2 * margem) / larg0, (tela.h - 2 * margem) / alt0));
  const zReal = Math.max(2, Math.min(ZOOM_MAX, zFit));
  const z = Math.floor(zReal), esc = 2 ** (zReal - z);
  const cx = (px(minLon, z) + px(maxLon, z)) / 2, cy = (py(minLat, z) + py(maxLat, z)) / 2;
  try {
    return await pintarBlocos(canvas, z, cx, cy, esc, tela, (ctx, xy) => {
      const quebras = new Set(lacunas);
      const linha = (largura, estilo, tracejar) => {
        ctx.lineJoin = 'round'; ctx.lineCap = 'round';
        for (let i = 1; i < pontos.length; i++) {
          const sem = quebras.has(i);
          if (tracejar !== sem) continue;
          const [ax, ay] = xy(pontos[i - 1][0], pontos[i - 1][1]), [bx, by] = xy(pontos[i][0], pontos[i][1]);
          ctx.beginPath(); ctx.moveTo(ax, ay); ctx.lineTo(bx, by);
          ctx.lineWidth = largura; ctx.strokeStyle = estilo; ctx.setLineDash(sem ? [5, 7] : []); ctx.stroke();
        }
        ctx.setLineDash([]);
      };
      if (guia.length) {
        ctx.lineJoin = 'round'; ctx.lineCap = 'round';
        ctx.beginPath();
        guia.forEach((p, i) => { const [x, y] = xy(p[0], p[1]); if (i) ctx.lineTo(x, y); else ctx.moveTo(x, y); });
        ctx.lineWidth = 8; ctx.strokeStyle = 'rgba(19,138,148,.5)'; ctx.stroke();
      }
      linha(8, 'rgba(255,255,255,.95)', false);
      linha(4.5, cor, false);
      linha(3, 'rgba(90,90,100,.8)', true);
      const ponta = (p, fundo, borda) => {
        const [x, y] = xy(p[0], p[1]);
        ctx.beginPath(); ctx.arc(x, y, 7, 0, Math.PI * 2);
        ctx.fillStyle = fundo; ctx.fill(); ctx.lineWidth = 3; ctx.strokeStyle = borda; ctx.stroke();
      };
      ponta(pontos[0], '#ffffff', '#1f1f24');
      ponta(pontos[pontos.length - 1], cor, '#ffffff');
    }, () => canvas.dataset.mapa === marca);
  } catch {
    return false;
  }
}

/** Onde você está agora (antes de sair): mapa centrado na posição, com o círculo da precisão. */
export async function posicaoNoMapa(canvas, lat, lon, acc, cor = '#fc5200') {
  if (!podeUsarMapa()) return false;
  const tela = preparar(canvas);
  if (!tela) return false;
  const z = 16;
  const cx = px(lon, z), cy = py(lat, z);
  const marca = (canvas.dataset.mapa = String(Math.random()));
  try {
    return await pintarBlocos(canvas, z, cx, cy, 1, tela, (ctx, xy) => {
      const [x, y] = xy(lat, lon);
      const metrosPorPx = 156543.03 * Math.cos(lat * Math.PI / 180) / 2 ** z;
      const r = Math.max(8, (acc || 0) / metrosPorPx);
      ctx.beginPath(); ctx.arc(x, y, r, 0, Math.PI * 2);
      ctx.fillStyle = 'rgba(252,82,0,.14)'; ctx.fill();
      ctx.beginPath(); ctx.arc(x, y, 9, 0, Math.PI * 2);
      ctx.fillStyle = cor; ctx.fill(); ctx.lineWidth = 3.5; ctx.strokeStyle = '#ffffff'; ctx.stroke();
    }, () => canvas.dataset.mapa === marca);
  } catch {
    return false;
  }
}
