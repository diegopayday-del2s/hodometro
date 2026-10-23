// Geometria e filtros de posição. Sem DOM: roda no navegador e no Node (testes).

export const RAIO_TERRA = 6371008.8; // metros (raio médio)
const rad = g => g * Math.PI / 180;

export const limitar = (v, min, max) => Math.min(max, Math.max(min, v));

/** Distância em metros entre dois pontos (fórmula de haversine). */
export function distancia(lat1, lon1, lat2, lon2) {
  const dLat = rad(lat2 - lat1);
  const dLon = rad(lon2 - lon1);
  const a = Math.sin(dLat / 2) ** 2 + Math.cos(rad(lat1)) * Math.cos(rad(lat2)) * Math.sin(dLon / 2) ** 2;
  return 2 * RAIO_TERRA * Math.asin(Math.min(1, Math.sqrt(a)));
}

/**
 * Projeção local em metros (equirretangular) a partir de uma origem.
 * Usada para filtrar o ruído; a distância somada entre pontos gravados
 * usa haversine.
 */
export class Projecao {
  constructor(lat0, lon0) {
    this.lat0 = lat0;
    this.lon0 = lon0;
    this.ky = RAIO_TERRA * Math.PI / 180;
    this.kx = this.ky * Math.cos(rad(lat0));
  }
  paraXY(lat, lon) {
    return [(lon - this.lon0) * this.kx, (lat - this.lat0) * this.ky];
  }
  paraLatLon(x, y) {
    return [this.lat0 + y / this.ky, this.lon0 + x / this.kx];
  }
}

/**
 * Filtro de Kalman de velocidade constante, em metros, um eixo de cada vez.
 * Mede a posição do GPS e a velocidade com direção que o aparelho informa.
 * Com as duas medidas o tremido de lado some e as curvas são acompanhadas.
 * `a` (m/s²) é o quanto a bike pode mudar de ritmo.
 */
export class FiltroVelocidade {
  constructor(a = 1.5) { this.a = a; this.reset(); }
  reset() {
    this.ativo = false; this.t = 0;
    this.x = 0; this.vx = 0; this.y = 0; this.vy = 0;
    this.px = [0, 0, 0, 0]; this.py = [0, 0, 0, 0];
  }
  #prever(P, dt) {
    const q = this.a * this.a;
    const dt2 = dt * dt, dt3 = dt2 * dt, dt4 = dt3 * dt;
    const [p00, p01, p10, p11] = P;
    P[0] = p00 + dt * (p10 + p01) + dt2 * p11 + q * dt4 / 4;
    P[1] = p01 + dt * p11 + q * dt3 / 2;
    P[2] = p10 + dt * p11 + q * dt3 / 2;
    P[3] = p11 + q * dt2;
  }
  // Atualiza um eixo s = [pos, vel], medindo a posição (h = 0) ou a velocidade (h = 1)
  #medir(s, P, h, z, r2) {
    const ph = h === 0 ? P[0] : P[3];
    const cr = h === 0 ? P[2] : P[1];
    const den = ph + r2;
    const kp = h === 0 ? ph / den : cr / den;
    const kv = h === 0 ? cr / den : ph / den;
    const y = z - s[h];
    s[0] += kp * y; s[1] += kv * y;
    const [p00, p01, p10, p11] = P;
    if (h === 0) { P[0] = (1 - kp) * p00; P[1] = (1 - kp) * p01; P[2] = p10 - kv * p00; P[3] = p11 - kv * p01; }
    else { P[0] = p00 - kp * p10; P[1] = p01 - kp * p11; P[2] = (1 - kv) * p10; P[3] = (1 - kv) * p11; }
  }
  /** vel: [vx, vy] medidos (m/s) ou null. */
  atualizar(x, y, acc, t, vel = null, accVel = 0.6) {
    const r2 = Math.max(acc, 1) ** 2;
    if (!this.ativo) {
      this.ativo = true; this.t = t;
      this.x = x; this.y = y;
      this.vx = vel ? vel[0] : 0; this.vy = vel ? vel[1] : 0;
      const pv = vel ? accVel * accVel : 25;
      this.px = [r2, 0, 0, pv]; this.py = [r2, 0, 0, pv];
      return this.saida();
    }
    const dt = Math.max(0, (t - this.t) / 1000);
    const sx = [this.x + this.vx * dt, this.vx];
    const sy = [this.y + this.vy * dt, this.vy];
    if (dt > 0) { this.#prever(this.px, dt); this.#prever(this.py, dt); this.t = t; }
    this.#medir(sx, this.px, 0, x, r2);
    this.#medir(sy, this.py, 0, y, r2);
    if (vel) {
      const rv = accVel * accVel;
      this.#medir(sx, this.px, 1, vel[0], rv);
      this.#medir(sy, this.py, 1, vel[1], rv);
    }
    [this.x, this.vx] = sx;
    [this.y, this.vy] = sy;
    return this.saida();
  }
  saida() { return { x: this.x, y: this.y, vx: this.vx, vy: this.vy }; }
  toJSON() {
    return { a: this.a, ativo: this.ativo, t: this.t, x: this.x, vx: this.vx, y: this.y, vy: this.vy, px: this.px.slice(), py: this.py.slice() };
  }
  static deJSON(o) {
    const f = new FiltroVelocidade(o && o.a);
    if (o) Object.assign(f, o, { px: (o.px || [0, 0, 0, 0]).slice(), py: (o.py || [0, 0, 0, 0]).slice() });
    return f;
  }
}

/**
 * Filtro de Kalman de posição, para quando o aparelho não informa velocidade.
 * `q` (m/s) é quanto a posição pode mudar por segundo; com q ligado à
 * velocidade, o filtro segura o tremido parado e acompanha em movimento.
 */
export class FiltroPosicao {
  constructor() { this.reset(); }
  reset() { this.ativo = false; this.x = 0; this.y = 0; this.var = 0; this.t = 0; }
  atualizar(x, y, acc, t, q) {
    const r2 = Math.max(acc, 1) ** 2;
    if (!this.ativo) {
      this.ativo = true; this.x = x; this.y = y; this.var = r2; this.t = t;
      return { x, y };
    }
    const dt = (t - this.t) / 1000;
    if (dt > 0) { this.var += dt * q * q; this.t = t; }
    const k = this.var / (this.var + r2);
    this.x += k * (x - this.x);
    this.y += k * (y - this.y);
    this.var = (1 - k) * this.var;
    return { x: this.x, y: this.y };
  }
  toJSON() { return { ativo: this.ativo, x: this.x, y: this.y, var: this.var, t: this.t }; }
  static deJSON(o) { const f = new FiltroPosicao(); Object.assign(f, o || {}); return f; }
}
