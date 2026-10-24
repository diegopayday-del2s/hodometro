// Motor do pedal: recebe leituras do GPS e calcula distância, tempos,
// velocidades, pausas, parciais e subida. Sem DOM, testado em tests/.
//
// Leitura: { t (ms), lat, lon, acc (m), alt?, altAcc?, vel? (m/s), rumo? (graus) }
//
// Estados:
//   aguardando  ainda sem leitura boa do GPS
//   movendo     contando distância e tempo em movimento
//   parado      pausa automática (ou espera antes de sair)
//   pausado     pausa manual
//
// Como a distância é medida:
//   1. Leituras com precisão pior que 15 m são descartadas. Saltos impossíveis
//      também: acima de 85 km/h ou longe demais do que a velocidade medida
//      permite andar desde a última leitura.
//   2. A posição passa por um filtro de Kalman. Se o aparelho informa
//      velocidade e direção (Doppler), o filtro usa as duas medidas.
//   3. Só soma distância em movimento, acima de 2 km/h e quando andou mais que
//      a margem de erro da posição, para o tremido parado não virar quilômetro.
//   4. Com Doppler, a distância de cada trecho sai da velocidade integrada
//      no tempo, desde que bata com o deslocamento do GPS.
import { Projecao, FiltroVelocidade, FiltroPosicao, distancia, limitar } from './geo.js';

export const PADRAO = Object.freeze({
  precisaoMax: 15,          // m: leituras piores que isso são ignoradas
  autoPausa: true,
  velParada: 0.8,           // m/s (2,9 km/h): abaixo disso pode estar parado
  velRetomada: 1.4,         // m/s (5 km/h): acima disso voltou a andar
  tempoConfirmaParada: 5,   // s abaixo de velParada para pausar
  velMaxPlausivel: 85 / 3.6, // m/s (85 km/h): acima disso é salto do GPS
  velMinDistancia: 2 / 3.6, // m/s (2 km/h): abaixo disso não soma distância
  folgaSalto: 10,           // m: folga do teste de salto contra a velocidade medida
  lacuna: 12,               // s sem leitura boa vira trecho sem sinal
  sinalFracoApos: 15,       // s sem leitura boa para avisar sinal fraco
  aceleracao: 1.5,          // m/s²: o quanto a bike muda de ritmo (filtro com Doppler)
  janelaVel: 5,             // s: janela da velocidade calculada pela posição
  confirmaSemDoppler: 12,   // s parado num raio pequeno para pausar quando só há posição
  raioParadaMin: 8,         // m: raio da parada sem Doppler (mínimo)
  raioParadaFator: 1.2,     // × precisão
  saidaMin: 25,             // m: quanto precisa sair do lugar para retomar sem Doppler
  saidaFator: 2,            // × precisão
  memoriaDoppler: 20,       // s: o aparelho conta como "com Doppler" por esse tempo
  usarDoppler: true,
  altSuave: 0.25,           // suavização da altitude (0 a 1)
  altLimiar: 4,             // m: subida mínima para contar
  suaveVel: 0.4,            // suavização da velocidade exibida (0 a 1; menor = mais suave)
});

const r1 = v => Math.round(v * 10) / 10;
const r6 = v => Math.round(v * 1e6) / 1e6;
const mediana = a => a.slice().sort((x, y) => x - y)[Math.floor(a.length / 2)];

export class Rastreador {
  constructor(cfg = {}, inicio = Date.now()) {
    this.cfg = { ...PADRAO, ...cfg };
    this.inicio = inicio;
    this.estado = 'aguardando';
    this.distancia = 0;       // m
    this.tempoMov = 0;        // s
    this.velMax = 0;          // m/s
    this.velAtual = 0;        // m/s, para exibir
    this.subida = 0;          // m
    this.pontos = [];         // [lat, lon, tRel s, alt|null]
    this.parciais = [];       // [{km, tempo s}]
    this.paradas = [];        // [{ini, fim, tipo}] em s desde o início
    this.lacunas = [];        // [{i, dist, dur}] trechos sem sinal
    this.proj = null;
    this.fv = new FiltroVelocidade(this.cfg.aceleracao);
    this.fp = new FiltroPosicao();
    this.modoDop = false;     // usando o filtro com Doppler
    this.ultimoDop = null;    // ms da última leitura com velocidade do aparelho
    this.vDopAnt = null;
    this.dop = null;          // {d, ok} distância pela velocidade desde o último ponto
    this.janela = [];         // [{t, x, y}] posições recentes (filtro de posição)
    this.hist = [];           // [{t, x, y}] últimos 30 s de posições, para achar quando parou ou saiu
    this.movendoDesde = null; // ms em que entrou em movimento
    this.ultimoT = null;      // ms da última leitura aceita
    this.ultimoBom = inicio;
    this.commit = null;       // último ponto que somou distância {x, y, lat, lon}
    this.ancora = null;       // onde a parada começou {x, y}
    this.vels = [];           // últimas velocidades, para a máxima
    this.velsTela = [];       // últimas velocidades, para a exibida
    this.velTela = 0;         // velocidade suavizada para a tela
    this.ema = 0;
    this.abaixo = null;       // {desde, mov}: lento, ainda sem confirmar parada
    this.acima = 0;           // leituras seguidas acima de velRetomada
    this.acimaDesde = null;
    this.rejeitados = 0;
    this.ultimaCrua = null;   // última leitura aceita, sem filtro {x, y, acc}
    this.reancorar = false;
    this.paradaInicial = true;
    this.alt = null;
    this.altBase = null;
    this.movUltimoKm = 0;
    this.precisao = null;
    this.sinal = 'procurando';
    this.finalizado = false;
    this.fim = null;
  }

  rel(t) { return (t - this.inicio) / 1000; }

  /** Processa uma leitura do GPS. Devolve eventos: km, parou, retomou, sinal. */
  push(f) {
    const ev = [];
    const c = this.cfg;
    if (this.finalizado || !f || !Number.isFinite(f.lat) || !Number.isFinite(f.lon) || !Number.isFinite(f.t)) return ev;
    if (f.t < this.inicio - 2000) return ev;                      // leitura guardada de antes de começar
    if (this.ultimoT != null && f.t <= this.ultimoT) return ev;   // repetida ou fora de ordem
    const acc = Number.isFinite(f.acc) && f.acc > 0 ? f.acc : 999;
    this.precisao = acc;
    if (acc > c.precisaoMax) { this.#sinalRuim(f.t, ev); return ev; }

    if (!this.proj) this.proj = new Projecao(f.lat, f.lon);
    const [rx, ry] = this.proj.paraXY(f.lat, f.lon);
    const dtFix = this.ultimoT == null ? 0 : (f.t - this.ultimoT) / 1000;

    // Velocidade do aparelho (Doppler), quando existe
    const velValida = Number.isFinite(f.vel) && f.vel >= 0;
    const vDop = velValida && f.vel <= c.velMaxPlausivel ? f.vel : null;

    // Salto impossível: ignora até 3 seguidos; no 4º aceita o lugar novo sem somar distância.
    // É salto se passa de 85 km/h, se o próprio aparelho mede mais que isso, ou se
    // a posição pulou mais do que a velocidade medida permite andar desde a última leitura.
    let saltou = false;
    if (this.fp.ativo && dtFix > 0 && dtFix <= c.lacuna) {
      const d = Math.hypot(rx - this.fp.x, ry - this.fp.y);
      let salto = velValida && f.vel > c.velMaxPlausivel;
      if (d > acc + 10 && d / dtFix > c.velMaxPlausivel) salto = true;
      const u = this.ultimaCrua;
      if (!salto && vDop != null && u && dtFix <= 5) {
        const dCru = Math.hypot(rx - u.x, ry - u.y);
        const vRef = Math.max(vDop, this.vDopAnt ?? vDop);
        if (dCru > vRef * dtFix + 2 * Math.max(acc, u.acc) + c.folgaSalto) salto = true;
      }
      if (salto) {
        this.rejeitados++;
        if (this.rejeitados < 4) return ev;
        this.fv.reset(); this.fp.reset(); this.janela = [];
        saltou = true;
      }
    }
    this.rejeitados = 0;
    this.ultimaCrua = { x: rx, y: ry, acc };
    if (vDop != null) this.ultimoDop = f.t;
    const modoDop = this.ultimoDop != null && (f.t - this.ultimoDop) / 1000 <= c.memoriaDoppler;
    const rumo = Number.isFinite(f.rumo) ? f.rumo * Math.PI / 180 : null;
    const velMedida = vDop != null && vDop >= 1 && rumo != null ? [vDop * Math.sin(rumo), vDop * Math.cos(rumo)] : null;

    // Os dois filtros andam juntos; usa o de Doppler quando o aparelho mede velocidade
    const pv = this.fv.atualizar(rx, ry, acc, f.t, velMedida);
    const pp = this.fp.atualizar(rx, ry, acc, f.t, Math.max(1.5, vDop ?? this.ema));
    const p = modoDop ? pv : pp;
    const [plat, plon] = this.proj.paraLatLon(p.x, p.y);
    const trocouModo = modoDop !== this.modoDop;
    this.modoDop = modoDop;

    // Velocidade pela posição, numa janela de poucos segundos
    this.janela.push({ t: f.t, x: pp.x, y: pp.y });
    while (this.janela.length > 2 && (f.t - this.janela[0].t) / 1000 > c.janelaVel) this.janela.shift();
    const j0 = this.janela[0];
    const dtJ = (f.t - j0.t) / 1000;
    const vJan = dtJ >= 2 ? Math.hypot(pp.x - j0.x, pp.y - j0.y) / dtJ : null;
    this.hist.push({ t: f.t, x: pp.x, y: pp.y });
    while (this.hist.length > 2 && (f.t - this.hist[0].t) / 1000 > 30) this.hist.shift();
    let v = vDop ?? vJan ?? 0;
    if (vDop != null && vDop < 0.5 && vJan != null && vJan > 3) v = vJan;   // aparelho travado em zero

    const vDopAnt = this.vDopAnt;
    this.vDopAnt = vDop;
    const t0 = this.ultimoT;
    this.ultimoT = f.t;
    this.ultimoBom = f.t;
    if (this.sinal !== 'ok') { this.sinal = 'ok'; ev.push({ tipo: 'sinal', sinal: 'ok' }); }

    if (this.estado === 'aguardando') {
      this.#ancorar(p, plat, plon);
      this.#ponto(plat, plon, f);
      this.estado = c.autoPausa ? 'parado' : 'movendo';
      this.#altitude(f, false);
      if (this.estado === 'movendo') this.movendoDesde = f.t;
      return ev;
    }

    if (this.estado === 'pausado') {
      this.ema = 0; this.velAtual = 0;
      this.#altitude(f, false);
      return ev;
    }

    if (saltou || this.reancorar) {
      // Depois de salto ou de pausa manual: recomeça daqui sem somar o trecho
      if (saltou) this.lacunas.push({ i: this.pontos.length, dist: 0, dur: r1(dtFix) });
      this.reancorar = false;
      this.#ancorar(p, plat, plon);
      this.#ponto(plat, plon, f);
      return ev;
    }
    // Trocou de filtro: os dois diferem alguns metros, então só muda a referência
    if (trocouModo) this.#ancorar(p, plat, plon);

    const dt = (f.t - t0) / 1000;
    if (dt > c.lacuna) {
      this.#lacuna(p, plat, plon, f, t0, dt, acc, ev);
      return ev;
    }

    const d = Math.hypot(p.x - this.commit.x, p.y - this.commit.y);
    const passo = modoDop ? limitar(acc * 0.3, 2, 6) : limitar(acc * 2, 8, 20);

    if (this.estado === 'movendo') {
      const movAntes = this.tempoMov, dAntes = this.distancia;
      this.tempoMov += dt;
      if (!this.dop) this.dop = { d: 0, ok: true };
      if (vDop != null && vDopAnt != null) this.dop.d += 0.5 * (vDop + vDopAnt) * dt;
      else this.dop.ok = false;
      // Abaixo de 2 km/h o trecho espera: se for tremido, não soma; se for
      // andar devagar, entra inteiro na próxima leitura mais rápida
      if (d >= passo && v >= c.velMinDistancia) this.#somar(p, plat, plon, f);
      this.#parciais(dAntes, movAntes, ev);
      this.#altitude(f, true);
      // Parada: com Doppler, velocidade baixa por alguns segundos. Só com posição,
      // que treme, ficar num raio pequeno por mais tempo.
      let parouEm = null, devolver = 0;
      if (c.autoPausa && modoDop) {
        if (v < c.velParada) {
          if (!this.abaixo) this.abaixo = { desde: t0, mov: 0 };
          this.abaixo.mov += dt;
          if ((f.t - this.abaixo.desde) / 1000 >= c.tempoConfirmaParada) { parouEm = this.abaixo.desde; devolver = this.abaixo.mov; }
        } else this.abaixo = null;
      } else if (c.autoPausa) {
        const desde = Math.max(this.#dentroDoRaioDesde(Math.max(c.raioParadaMin, c.raioParadaFator * acc)), this.movendoDesde ?? -Infinity);
        if ((f.t - desde) / 1000 >= c.confirmaSemDoppler) { parouEm = desde; devolver = (f.t - desde) / 1000; }
      }
      if (parouEm != null) {
        // Confirmou a parada: devolve o tempo desde que parou
        this.tempoMov = Math.max(0, this.tempoMov - devolver);
        this.paradas.push({ ini: r1(this.rel(parouEm)), fim: null, tipo: 'auto' });
        this.estado = 'parado';
        this.ancora = modoDop ? { x: p.x, y: p.y } : this.#centro(parouEm);
        this.abaixo = null;
        this.acima = 0; this.acimaDesde = null;
        this.ema = 0;
        this.dop = null;
        ev.push({ tipo: 'parou' });
      }
      if (this.estado === 'movendo') {
        this.ema = this.ema ? 0.5 * v + 0.5 * this.ema : v;
        this.#suavizar(v);
        if (acc <= 20) {
          this.vels.push(v);
          if (this.vels.length > 3) this.vels.shift();
          if (this.vels.length === 3) this.velMax = Math.max(this.velMax, mediana(this.vels));
        }
      }
    } else if (this.estado === 'parado') {
      this.ema = 0;
      if (v >= c.velRetomada) {
        if (!this.acima) this.acimaDesde = t0;
        this.acima++;
      } else { this.acima = 0; this.acimaDesde = null; }
      // Com Doppler, duas leituras rápidas bastam. Só com posição, que treme,
      // pede três leituras rápidas e ter saído do lugar onde parou.
      const desloc = Math.hypot(p.x - this.ancora.x, p.y - this.ancora.y);
      const saiu = modoDop ? this.acima >= 2 : this.acima >= 3 && desloc >= Math.max(c.saidaMin, c.saidaFator * acc);
      if (saiu) {
        // Hora da saída: com Doppler, a primeira leitura rápida; só com posição,
        // a última vez que esteve perto do lugar onde parou
        const desde = modoDop ? (this.acimaDesde ?? t0) : this.#ultimaVezPerto(this.ancora, Math.max(c.raioParadaMin, c.raioParadaFator * acc), t0);
        const movAntes = this.tempoMov, dAntes = this.distancia;
        this.tempoMov += (f.t - desde) / 1000;
        this.dop = null;
        if (d >= passo) this.#somar(p, plat, plon, f);
        this.#parciais(dAntes, movAntes, ev);
        const aberta = this.paradas[this.paradas.length - 1];
        if (this.paradaInicial) this.paradaInicial = false;
        else {
          if (aberta && aberta.fim == null) aberta.fim = r1(Math.max(aberta.ini, this.rel(desde)));
          ev.push({ tipo: 'retomou' });
        }
        this.estado = 'movendo';
        this.movendoDesde = desde;
        this.acima = 0; this.acimaDesde = null;
        this.ema = v;
        this.velsTela = []; this.velTela = 0;
        this.#suavizar(v);
        this.#altitude(f, true);
      } else {
        this.#altitude(f, false);
      }
    }
    if (this.estado !== 'movendo') { this.velsTela = []; this.velTela = 0; }
    this.velAtual = this.estado === 'movendo' ? this.velTela : 0;
    return ev;
  }

  /** Chamar uma vez por segundo: avisa quando o sinal some. */
  tick(agora) {
    const ev = [];
    if (this.finalizado) return ev;
    if ((agora - this.ultimoBom) / 1000 > this.cfg.sinalFracoApos) {
      const s = this.estado === 'aguardando' ? 'procurando' : 'fraco';
      if (this.sinal !== s) { this.sinal = s; ev.push({ tipo: 'sinal', sinal: s }); }
      if (this.estado === 'movendo') this.velAtual = 0;
    }
    return ev;
  }

  pausar(agora) {
    if (this.finalizado || this.estado === 'pausado') return;
    if (this.estado === 'movendo') this.paradas.push({ ini: r1(this.rel(agora)), fim: null, tipo: 'manual' });
    else if (this.estado === 'parado' && !this.paradaInicial) {
      const aberta = this.paradas[this.paradas.length - 1];
      if (aberta && aberta.fim == null) aberta.tipo = 'manual';
    }
    this.estado = 'pausado';
    this.abaixo = null; this.acima = 0; this.acimaDesde = null;
    this.ema = 0; this.velAtual = 0; this.dop = null;
  }

  retomar(agora) {
    if (this.finalizado || this.estado !== 'pausado') return;
    this.reancorar = true;
    if (!this.proj) { this.estado = 'aguardando'; return; }
    if (this.cfg.autoPausa) {
      this.estado = 'parado';
    } else {
      this.estado = 'movendo';
      this.movendoDesde = agora;
      const aberta = this.paradas[this.paradas.length - 1];
      if (aberta && aberta.fim == null) aberta.fim = r1(this.rel(agora));
      this.paradaInicial = false;
    }
    // O tempo conta a partir daqui: a próxima leitura não soma o tempo pausado
    if (this.ultimoT != null) this.ultimoT = Math.max(this.ultimoT, agora - 1);
  }

  /** Números ao vivo para a tela. */
  painel(agora) {
    const total = Math.max(0, this.rel(agora));
    const extra = this.estado === 'movendo' && this.ultimoT != null ? limitar((agora - this.ultimoT) / 1000, 0, 3) : 0;
    const mov = Math.min(total, this.tempoMov + extra);
    return {
      estado: this.estado,
      sinal: this.sinal,
      precisao: this.precisao,
      distancia: this.distancia,
      tempoMov: mov,
      tempoTotal: total,
      tempoParado: Math.max(0, total - mov),
      velAtual: this.velAtual,
      velMedia: this.tempoMov > 0 ? this.distancia / this.tempoMov : 0,
      velMax: this.velMax,
      ritmo: this.distancia >= 50 && this.tempoMov > 0 ? this.tempoMov / (this.distancia / 1000) : null,
      subida: this.subida,
      pausas: this.paradas.length,
      parciais: this.parciais,
      pontos: this.pontos,
    };
  }

  /** Fecha o pedal e devolve o registro para salvar. */
  finalizar(agora) {
    if (!this.finalizado) {
      const aberta = this.paradas[this.paradas.length - 1];
      if ((this.estado === 'parado' || this.estado === 'pausado') && aberta && aberta.fim == null) {
        aberta.fim = r1(this.rel(agora));
        aberta.final = true;
      }
      this.fim = agora;
      this.finalizado = true;
    }
    const total = Math.max(0, (this.fim - this.inicio) / 1000);
    const mov = Math.min(total, this.tempoMov);
    const paradas = this.paradas.filter(p => !p.final);
    return {
      versao: 1,
      via: 'gps',
      inicio: this.inicio,
      fim: this.fim,
      distancia: Math.round(this.distancia),
      tempoMov: Math.round(mov),
      tempoTotal: Math.round(total),
      velMax: Math.round(this.velMax * 100) / 100,
      subida: Math.round(this.subida),
      pausas: paradas.length,
      tempoPausas: Math.round(paradas.reduce((a, p) => a + Math.max(0, (p.fim ?? total) - p.ini), 0)),
      parciais: this.parciais.slice(),
      paradas: this.paradas.slice(),
      lacunas: this.lacunas.slice(),
      pontos: this.pontos.slice(),
    };
  }

  // ----- internos -----

  /** Velocidade para a tela: mediana das 3 últimas (tira o pico) e média móvel exponencial. */
  #suavizar(v) {
    this.velsTela.push(v);
    if (this.velsTela.length > 3) this.velsTela.shift();
    const m = mediana(this.velsTela);
    this.velTela = this.velTela ? this.cfg.suaveVel * m + (1 - this.cfg.suaveVel) * this.velTela : m;
  }

  #ancorar(p, lat, lon) {
    this.commit = { x: p.x, y: p.y, lat, lon };
    this.ancora = { x: p.x, y: p.y };
    this.dop = null;
  }

  #somar(p, lat, lon, f) {
    // Distância pela posição (haversine) ou, se bater com ela, pela velocidade do aparelho
    const dPos = distancia(this.commit.lat, this.commit.lon, lat, lon);
    const dop = this.dop;
    const usarDop = this.cfg.usarDoppler && dop && dop.ok && dop.d > 0 && Math.abs(dop.d - dPos) <= Math.max(8, 0.35 * dPos);
    this.distancia += usarDop ? dop.d : dPos;
    this.dop = null;
    this.commit = { x: p.x, y: p.y, lat, lon };
    this.#ponto(lat, lon, f);
  }

  #ponto(lat, lon, f) {
    const alt = Number.isFinite(f.alt) ? r1(f.alt) : null;
    this.pontos.push([r6(lat), r6(lon), r1(this.rel(f.t)), alt]);
  }

  #parciais(dAntes, movAntes, ev) {
    while (this.distancia >= (this.parciais.length + 1) * 1000) {
      const alvo = (this.parciais.length + 1) * 1000;
      const frac = this.distancia > dAntes ? limitar((alvo - dAntes) / (this.distancia - dAntes), 0, 1) : 1;
      const tCruz = movAntes + frac * (this.tempoMov - movAntes);
      const tempo = Math.max(0, tCruz - this.movUltimoKm);
      this.movUltimoKm = tCruz;
      this.parciais.push({ km: alvo / 1000, tempo: r1(tempo) });
      ev.push({ tipo: 'km', km: alvo / 1000, tempo, media: this.tempoMov > 0 ? this.distancia / this.tempoMov : 0 });
      dAntes = alvo; movAntes = tCruz;
    }
  }

  #lacuna(p, plat, plon, f, t0, dt, acc, ev) {
    const c = this.cfg;
    const d = Math.hypot(p.x - this.commit.x, p.y - this.commit.y);
    this.dop = null;
    this.abaixo = null; this.acima = 0; this.acimaDesde = null;
    this.janela = [{ t: f.t, x: this.fp.x, y: this.fp.y }];
    if (d / dt > c.velMaxPlausivel) {
      // Rápido demais para bike (carro, ônibus ou erro): recomeça daqui sem somar
      this.lacunas.push({ i: this.pontos.length, dist: 0, dur: r1(dt) });
      this.#ancorar(p, plat, plon);
      this.#ponto(plat, plon, f);
      return;
    }
    if (d >= Math.max(25, 2 * acc)) {
      // Andou sem sinal (tela bloqueada, túnel): soma em linha reta.
      // O tempo em movimento do trecho sai da média até aqui.
      const vRef = this.tempoMov > 60 && this.distancia > 300 ? this.distancia / this.tempoMov : 4.2;
      const tMov = Math.min(dt, d / limitar(vRef, 2, 12));
      const movAntes = this.tempoMov, dAntes = this.distancia;
      this.tempoMov += tMov;
      this.lacunas.push({ i: this.pontos.length, dist: Math.round(d), dur: r1(dt) });
      this.#somar(p, plat, plon, f);
      this.#parciais(dAntes, movAntes, ev);
      const aberta = this.paradas[this.paradas.length - 1];
      if (this.estado === 'parado') {
        if (this.paradaInicial) this.paradaInicial = false;
        else if (aberta && aberta.fim == null) aberta.fim = r1(this.rel(t0) + Math.max(0, dt - tMov));
      }
      this.estado = 'movendo';
      this.movendoDesde = f.t;
      this.ema = 0;
      this.velAtual = 0;
      return;
    }
    // Ficou parado sem sinal
    if (this.estado === 'movendo' && c.autoPausa) {
      this.paradas.push({ ini: r1(this.rel(t0)), fim: null, tipo: 'auto' });
      this.estado = 'parado';
      this.ancora = { x: this.commit.x, y: this.commit.y };
      this.ema = 0; this.velAtual = 0;
      ev.push({ tipo: 'parou' });
    } else if (this.estado === 'movendo') {
      this.tempoMov += dt;
    }
  }

  /** Desde quando (ms) as posições recentes estão todas a menos de `raio` da atual. */
  #dentroDoRaioDesde(raio) {
    const h = this.hist, u = h[h.length - 1];
    let t = u.t;
    for (let i = h.length - 2; i >= 0; i--) {
      if (Math.hypot(h[i].x - u.x, h[i].y - u.y) > raio) break;
      t = h[i].t;
    }
    return t;
  }

  /** Centro das posições desde `t` (ms): referência estável de onde parou. */
  #centro(t) {
    const pts = this.hist.filter(h => h.t >= t);
    if (!pts.length) return { x: this.fp.x, y: this.fp.y };
    return { x: pts.reduce((a, h) => a + h.x, 0) / pts.length, y: pts.reduce((a, h) => a + h.y, 0) / pts.length };
  }

  /** Última vez (ms) que a posição esteve a menos de `raio` do ponto. */
  #ultimaVezPerto(ponto, raio, padrao) {
    for (let i = this.hist.length - 1; i >= 0; i--) {
      if (Math.hypot(this.hist[i].x - ponto.x, this.hist[i].y - ponto.y) <= raio) return this.hist[i].t;
    }
    return padrao;
  }

  #altitude(f, contar) {
    if (!Number.isFinite(f.alt) || (Number.isFinite(f.altAcc) && f.altAcc > 20)) return;
    this.alt = this.alt == null ? f.alt : this.alt + this.cfg.altSuave * (f.alt - this.alt);
    if (this.altBase == null) { this.altBase = this.alt; return; }
    // Histerese: só conta subida e só desce a referência quando passa do limiar,
    // para o sobe e desce do ruído não somar
    const L = this.cfg.altLimiar;
    if (this.alt >= this.altBase + L) {
      if (contar) this.subida += this.alt - this.altBase;
      this.altBase = this.alt;
    } else if (this.alt <= this.altBase - L) {
      this.altBase = this.alt;
    }
  }

  #sinalRuim(t, ev) {
    if ((t - this.ultimoBom) / 1000 > this.cfg.sinalFracoApos) {
      const s = this.estado === 'aguardando' ? 'procurando' : 'fraco';
      if (this.sinal !== s) { this.sinal = s; ev.push({ tipo: 'sinal', sinal: s }); }
    }
  }

  // ----- salvar e recuperar no meio do pedal -----

  toJSON() {
    const o = {};
    for (const k of Object.keys(this)) o[k] = this[k];
    o.proj = this.proj ? { lat0: this.proj.lat0, lon0: this.proj.lon0 } : null;
    o.fv = this.fv.toJSON();
    o.fp = this.fp.toJSON();
    return o;
  }

  static deJSON(o) {
    const r = new Rastreador(o.cfg, o.inicio);
    for (const k of Object.keys(o)) if (!['proj', 'fv', 'fp', 'cfg'].includes(k)) r[k] = o[k];
    r.cfg = { ...PADRAO, ...o.cfg };
    r.proj = o.proj ? new Projecao(o.proj.lat0, o.proj.lon0) : null;
    r.fv = FiltroVelocidade.deJSON(o.fv);
    r.fp = FiltroPosicao.deJSON(o.fp);
    return r;
  }
}

/** Distância total de uma lista de pontos gravados [lat, lon, ...]. */
export function distanciaPontos(pontos) {
  let d = 0;
  for (let i = 1; i < pontos.length; i++) d += distancia(pontos[i - 1][0], pontos[i - 1][1], pontos[i][0], pontos[i][1]);
  return d;
}
