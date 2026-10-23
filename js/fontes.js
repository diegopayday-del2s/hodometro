// De onde vêm as leituras: o GPS do celular ou um pedal simulado.
import { gerarPercurso, PEDAL_DEMO } from './simulador.js';

function converter(pos) {
  const c = pos.coords;
  const agora = Date.now();
  // Alguns aparelhos mandam o horário da leitura com relógio estranho
  let t = pos.timestamp;
  if (!Number.isFinite(t) || Math.abs(t - agora) > 30000) t = agora;
  return {
    t,
    lat: c.latitude,
    lon: c.longitude,
    acc: c.accuracy,
    alt: Number.isFinite(c.altitude) ? c.altitude : null,
    altAcc: Number.isFinite(c.altitudeAccuracy) ? c.altitudeAccuracy : null,
    vel: Number.isFinite(c.speed) && c.speed >= 0 ? c.speed : null,
    rumo: Number.isFinite(c.heading) && c.heading >= 0 ? c.heading : null,
  };
}

export class FonteGPS {
  constructor() { this.id = null; this.simulada = false; }
  get ativa() { return this.id != null; }
  agora() { return Date.now(); }
  iniciar(aoLer, aoErrar) {
    if (this.id != null) return;
    if (!('geolocation' in navigator)) { aoErrar({ code: 0, message: 'Este navegador não tem GPS.' }); return; }
    this.id = navigator.geolocation.watchPosition(
      pos => aoLer(converter(pos)),
      err => aoErrar(err),
      { enableHighAccuracy: true, maximumAge: 0, timeout: 30000 },
    );
  }
  parar() {
    if (this.id != null) navigator.geolocation.clearWatch(this.id);
    this.id = null;
  }
}

/** Pedal de demonstração acelerado: `fator` segundos de pedal por segundo real. */
export class FonteSimulada {
  constructor(fator = 8) {
    this.simulada = true;
    this.fator = fator;
    const t0 = Date.now();
    this.leituras = gerarPercurso(PEDAL_DEMO, { t0, semente: t0 % 100000 }).leituras;
    this.t0 = t0;
    this.real0 = null;
    this.i = 0;
    this.timer = null;
    this.acabou = false;
  }
  get ativa() { return this.timer != null; }
  agora() { return this.real0 == null ? this.t0 : this.t0 + (Date.now() - this.real0) * this.fator; }
  iniciar(aoLer) {
    if (this.timer) return;
    if (this.real0 == null) this.real0 = Date.now();
    this.timer = setInterval(() => {
      const ag = this.agora();
      while (this.i < this.leituras.length && this.leituras[this.i].t <= ag) aoLer(this.leituras[this.i++]);
      if (this.i >= this.leituras.length) this.acabou = true;
    }, 100);
  }
  parar() { clearInterval(this.timer); this.timer = null; }
}
