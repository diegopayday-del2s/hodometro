// Gera leituras de GPS falsas, com o tremido de um celular de verdade.
// Usado nos testes e no modo demonstração do app.
import { Projecao } from './geo.js';

export function sorteador(semente = 1) {
  let a = semente >>> 0;
  return () => {
    a = (a + 0x6D2B79F5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

/**
 * trechos: lista de
 *   { tipo: 'reta', dist (m), vel (m/s), rumo? (graus), subida? (m) }
 *   { tipo: 'curva', raio (m), graus, vel (m/s) }       graus > 0 vira à direita
 *   { tipo: 'parada', dur (s) }
 *   { tipo: 'semSinal', trecho }                         anda sem gerar leitura
 *   { tipo: 'ruim', trecho, acc }                        leituras com precisão ruim
 *   { tipo: 'salto', dist (m) }                          uma leitura fora do lugar
 */
export function gerarPercurso(trechos, opcoes = {}) {
  const o = {
    lat0: -23.5505, lon0: -46.6333, t0: 1767225600000, hz: 1,
    ruido: 4, branco: 1.5, corr: 0.92, acc: 6,
    doppler: true, ruidoVel: 0.25, alt0: 760, ruidoAlt: 2.5, semente: 7,
    ...opcoes,
  };
  const sorte = sorteador(o.semente);
  const gauss = () => {
    const u = Math.max(1e-12, sorte()), v = sorte();
    return Math.sqrt(-2 * Math.log(u)) * Math.cos(2 * Math.PI * v);
  };
  const proj = new Projecao(o.lat0, o.lon0);
  const dt = 1 / o.hz;
  const s = { x: 0, y: 0, rumo: 0, t: 0, alt: o.alt0 };
  let ex = 0, ey = 0;
  const leituras = [];
  let distReal = 0, movReal = 0, subidaReal = 0;
  const kAr = Math.sqrt(1 - o.corr * o.corr);

  function emitir(vel, extra = {}) {
    ex = o.corr * ex + gauss() * o.ruido * kAr;
    ey = o.corr * ey + gauss() * o.ruido * kAr;
    if (extra.semLeitura) return;
    const mult = extra.mult || 1;
    const nx = s.x + (ex + gauss() * o.branco) * mult + (extra.dx || 0);
    const ny = s.y + (ey + gauss() * o.branco) * mult + (extra.dy || 0);
    const [lat, lon] = proj.paraLatLon(nx, ny);
    leituras.push({
      t: Math.round(o.t0 + s.t * 1000),
      lat, lon,
      acc: extra.acc ?? o.acc * (0.85 + 0.3 * sorte()),
      alt: s.alt + gauss() * o.ruidoAlt,
      vel: o.doppler ? Math.max(0, vel > 0 ? vel + gauss() * o.ruidoVel : Math.abs(gauss()) * 0.15) : null,
      rumo: o.doppler && vel >= 1 ? ((s.rumo + gauss() * 4) % 360 + 360) % 360 : null,
    });
  }

  function mover(vel, extra) {
    const rad = s.rumo * Math.PI / 180;
    s.x += Math.sin(rad) * vel * dt;
    s.y += Math.cos(rad) * vel * dt;
    s.t += dt;
    distReal += vel * dt;
    movReal += dt;
    emitir(vel, extra);
  }

  function trecho(tr, extra = {}) {
    if (tr.tipo === 'reta') {
      if (tr.rumo != null) s.rumo = tr.rumo;
      const n = Math.max(1, Math.round(tr.dist / tr.vel * o.hz));
      const v = tr.dist / (n * dt);
      const dAlt = (tr.subida || 0) / n;
      for (let i = 0; i < n; i++) {
        s.alt += dAlt;
        if (dAlt > 0) subidaReal += dAlt;
        mover(v, extra);
      }
    } else if (tr.tipo === 'curva') {
      const arco = tr.raio * Math.abs(tr.graus) * Math.PI / 180;
      const n = Math.max(1, Math.round(arco / tr.vel * o.hz));
      const passoGraus = tr.graus / n;
      const corda = 2 * tr.raio * Math.sin(Math.abs(passoGraus) * Math.PI / 360);
      for (let i = 0; i < n; i++) {
        s.rumo += passoGraus / 2;
        const rad = s.rumo * Math.PI / 180;
        s.x += Math.sin(rad) * corda;
        s.y += Math.cos(rad) * corda;
        s.rumo += passoGraus / 2;
        s.t += dt;
        distReal += corda;
        movReal += dt;
        emitir(corda / dt, extra);
      }
    } else if (tr.tipo === 'parada') {
      const n = Math.round(tr.dur * o.hz);
      for (let i = 0; i < n; i++) { s.t += dt; emitir(0, extra); }
    } else if (tr.tipo === 'semSinal') {
      trecho(tr.trecho, { ...extra, semLeitura: true });
    } else if (tr.tipo === 'ruim') {
      trecho(tr.trecho, { ...extra, acc: tr.acc || 60, mult: 6 });
    } else if (tr.tipo === 'salto') {
      const ang = sorte() * 2 * Math.PI;
      s.t += dt;
      emitir(0, { dx: Math.cos(ang) * tr.dist, dy: Math.sin(ang) * tr.dist, acc: o.acc });
    }
  }

  for (const tr of trechos) trecho(tr);
  return { leituras, distReal, movReal, totalReal: s.t, subidaReal };
}

/** Um pedal de cidade de uns 6 km, com semáforos, curvas e uma subida. */
export const PEDAL_DEMO = [
  { tipo: 'parada', dur: 8 },
  { tipo: 'reta', dist: 900, vel: 5.2, rumo: 20 },
  { tipo: 'curva', raio: 15, graus: 90, vel: 3.5 },
  { tipo: 'reta', dist: 1200, vel: 6.1 },
  { tipo: 'parada', dur: 35 },
  { tipo: 'reta', dist: 700, vel: 4.2, subida: 28 },
  { tipo: 'curva', raio: 20, graus: -70, vel: 4 },
  { tipo: 'reta', dist: 1500, vel: 7.5 },
  { tipo: 'parada', dur: 50 },
  { tipo: 'curva', raio: 12, graus: 120, vel: 3 },
  { tipo: 'reta', dist: 1100, vel: 5.6 },
  { tipo: 'reta', dist: 500, vel: 9.5 },
  { tipo: 'parada', dur: 10 },
];
