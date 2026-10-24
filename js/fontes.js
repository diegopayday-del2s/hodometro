// De onde vêm as leituras: o GPS do navegador, o GPS nativo do Android
// (chip GNSS, continua com a tela apagada) ou um pedal simulado.
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

/** Leitura do plugin Gravador (o horário já vem conferido pelo Android). */
export function converterNativo(l) {
  const num = v => (Number.isFinite(v) ? v : null);
  return {
    t: Number.isFinite(l.t) ? l.t : Date.now(),
    lat: l.lat,
    lon: l.lon,
    acc: num(l.acc) ?? 999,
    alt: num(l.alt),
    altAcc: num(l.altAcc),
    vel: num(l.vel) != null && l.vel >= 0 ? l.vel : null,
    rumo: num(l.rumo) != null && l.rumo >= 0 ? l.rumo : null,
  };
}

/**
 * GPS do app Android, lido direto do chip (GNSS), sem Wi-Fi nem rede de celular.
 *
 * Sem `fundo`, só observa o sinal antes de sair. Com `fundo: true`, grava pelo
 * serviço do Android: notificação na tela de bloqueio, trava de CPU e GPS ligado
 * com a tela apagada. O serviço também guarda as leituras num arquivo; se o app
 * fechar no meio do pedal, `perdidas(desde)` devolve o que ele gravou sozinho.
 */
export class FonteNativa {
  constructor() {
    this.simulada = false;
    this.modo = null;          // 'observar' | 'gravar' | null
    this.aoLer = null;
    this.aoErrar = null;
    this.aoSatelites = null;
    this.geracao = 0;
    this.ouvindo = null;
  }
  get ativa() { return this.modo != null; }
  get gravando() { return this.modo === 'gravar'; }
  agora() { return Date.now(); }

  #ouvir() {
    if (!this.ouvindo) {
      this.ouvindo = Promise.all([
        chamar('Gravador', 'addListener', 'leitura', l => { if (this.modo && this.aoLer) this.aoLer(converterNativo(l)); }),
        chamar('Gravador', 'addListener', 'satelites', s => { if (this.aoSatelites) this.aoSatelites(s); }),
        chamar('Gravador', 'addListener', 'gps', g => {
          if (!g.ligado && this.modo && this.aoErrar) this.aoErrar({ code: 2, tipo: 'GPS_DESLIGADO', message: 'A localização do celular foi desligada.' });
        }),
      ]).then(() => true).catch(e => { this.ouvindo = null; throw e; });
    }
    return this.ouvindo;
  }

  /** opções: fundo (gravar), novo (pedal novo, apaga o arquivo anterior), titulo e texto da notificação, aoSatelites. */
  iniciar(aoLer, aoErrar, { fundo = false, novo = false, titulo, texto, aoSatelites } = {}) {
    this.aoLer = aoLer;
    this.aoErrar = aoErrar;
    if (aoSatelites) this.aoSatelites = aoSatelites;
    if (this.modo === 'gravar' && !fundo) return;   // gravando não volta a só observar
    this.modo = fundo ? 'gravar' : 'observar';
    const geracao = ++this.geracao;
    this.#ouvir()
      .then(() => (fundo ? chamar('Gravador', 'iniciar', { novo, titulo, texto }) : chamar('Gravador', 'observar')))
      .catch(e => {
        if (geracao !== this.geracao) return;
        this.modo = null;
        const tipo = e && e.code;
        aoErrar({ code: tipo === 'SEM_PERMISSAO' ? 1 : 2, tipo, message: (e && e.message) || String(e) });
      });
  }

  parar() {
    const era = this.modo;
    this.modo = null;
    this.geracao++;
    if (era === 'gravar') chamar('Gravador', 'parar').catch(() => {});
    else if (era === 'observar') chamar('Gravador', 'pararObservar').catch(() => {});
  }

  /** Leituras que o serviço gravou depois de `desde` (ms), com o app fechado ou em segundo plano. */
  async perdidas(desde) {
    const r = await chamar('Gravador', 'leituras', { desde: Math.floor(desde || 0) });
    return ((r && r.leituras) || []).map(converterNativo);
  }

  /** Apaga o arquivo de leituras depois que o pedal foi salvo. */
  limpar() { return chamar('Gravador', 'limpar').catch(() => {}); }

  /** Números da notificação na tela de bloqueio. */
  notificar(titulo, texto) { return chamar('Gravador', 'atualizar', { titulo, texto }).catch(() => {}); }

  /** tipo: 'app', 'localizacao' ou 'notificacoes'. */
  abrirAjustes(tipo = 'app') { return chamar('Gravador', 'abrirAjustes', { tipo }).catch(() => {}); }
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
