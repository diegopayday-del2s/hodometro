// De onde vêm as leituras: o GPS do navegador, o GPS nativo do Android
// (continua com a tela apagada) ou um pedal simulado.
import { gerarPercurso, PEDAL_DEMO } from './simulador.js';
import { chamar } from './nativo.js';

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

function converterNativo(l) {
  const agora = Date.now();
  let t = l.time;
  if (!Number.isFinite(t) || Math.abs(t - agora) > 30000) t = agora;
  return {
    t,
    lat: l.latitude,
    lon: l.longitude,
    acc: l.accuracy,
    alt: Number.isFinite(l.altitude) ? l.altitude : null,
    altAcc: Number.isFinite(l.altitudeAccuracy) ? l.altitudeAccuracy : null,
    vel: Number.isFinite(l.speed) && l.speed >= 0 ? l.speed : null,
    rumo: Number.isFinite(l.bearing) && l.bearing >= 0 ? l.bearing : null,
  };
}

/**
 * GPS do app Android. Com `fundo: true` roda como serviço com notificação
 * ("Hodômetro gravando") e segue mandando leituras com a tela apagada.
 */
export class FonteNativa {
  constructor() { this.id = null; this.pedindo = false; this.fundo = false; this.geracao = 0; this.simulada = false; }
  get ativa() { return this.id != null || this.pedindo; }
  agora() { return Date.now(); }
  iniciar(aoLer, aoErrar, { fundo = false } = {}) {
    if (this.ativa && this.fundo === fundo) return;
    this.parar();
    this.fundo = fundo;
    this.pedindo = true;
    const geracao = ++this.geracao;
    const opcoes = { requestPermissions: true, stale: false, distanceFilter: 0 };
    if (fundo) {
      opcoes.backgroundTitle = 'Hodômetro gravando';
      opcoes.backgroundMessage = 'Gravando o seu pedal pelo GPS. Toque para abrir.';
    }
    chamar('BackgroundGeolocation', 'addWatcher', opcoes, (loc, erro) => {
      if (geracao !== this.geracao) return;
      if (erro) {
        aoErrar({ code: erro.code === 'NOT_AUTHORIZED' ? 1 : 2, message: erro.message || String(erro) });
        return;
      }
      if (loc) aoLer(converterNativo(loc));
    })
      .then(id => {
        if (geracao !== this.geracao) { chamar('BackgroundGeolocation', 'removeWatcher', { id }).catch(() => {}); return; }
        this.id = id;
        this.pedindo = false;
      })
      .catch(e => {
        if (geracao !== this.geracao) return;
        this.pedindo = false;
        aoErrar({ code: 2, message: (e && e.message) || String(e) });
      });
  }
  parar() {
    this.geracao++;
    const id = this.id;
    this.id = null;
    this.pedindo = false;
    if (id) chamar('BackgroundGeolocation', 'removeWatcher', { id }).catch(() => {});
  }
  abrirAjustes() { return chamar('BackgroundGeolocation', 'openSettings').catch(() => {}); }
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
