// Hodômetro: controle das telas, do GPS e da gravação.
import { Rastreador } from './rastreador.js';
import * as F from './formato.js';
import * as A from './armazem.js';
import { FonteGPS, FonteSimulada, FonteNativa } from './fontes.js';
import { ehNativo, chamar } from './nativo.js';
import { falar, temVoz } from './voz.js';
import { gerarGPX } from './gpx.js';
import { desenharTrajeto, graficoVelocidade } from './desenho.js';

export const VERSAO = '1.1.0';

// No app Android o GPS segue com a tela apagada; no navegador, não
const NATIVO = ehNativo();

const $ = s => document.querySelector(s);
const $$ = s => [...document.querySelectorAll(s)];

function h(tag, attrs, ...filhos) {
  const el = document.createElement(tag);
  if (attrs) for (const k in attrs) {
    const v = attrs[k];
    if (v == null || v === false) continue;
    if (k === 'class') el.className = v;
    else if (k === 'text') el.textContent = v;
    else if (k.startsWith('on')) el.addEventListener(k.slice(2), v);
    else if (k === 'style') el.style.cssText = v;
    else el.setAttribute(k, v === true ? '' : v);
  }
  for (const f of filhos.flat()) if (f != null && f !== false) el.append(f.nodeType ? f : document.createTextNode(String(f)));
  return el;
}

// ---------- ajustes ----------
const CFG_PADRAO = { autoPausa: true, telaLigada: !NATIVO, precisao: 25, voz: 1, vozPausa: false, meta: 0 };
function lerCfg() {
  try { return { ...CFG_PADRAO, ...JSON.parse(localStorage.getItem('hodometro.cfg') || '{}') }; }
  catch { return { ...CFG_PADRAO }; }
}
function salvarCfg() { try { localStorage.setItem('hodometro.cfg', JSON.stringify(S.cfg)); } catch { /* sem espaço */ } }

const S = {
  cfg: lerCfg(),
  pedais: [],
  tela: 'pedalar',
  periodo: 'semana',
  r: null,            // Rastreador do pedal em andamento
  fonte: null,        // de onde vêm as leituras do pedal em andamento
  demo: false,
  gps: { estado: 'desligado', acc: null },
  wake: null,
  wakeFalhou: false,
  instalar: null,
  detalhe: null,
  semSel: null,
  salvoEm: 0,
};
const gps = NATIVO ? new FonteNativa() : new FonteGPS();

// ---------- utilidades de tela ----------
let toastT = 0;
function aviso(msg, acaoTxt, acao, ms) {
  const t = $('#toast');
  t.replaceChildren(h('div', { class: 'toast-in' }, h('span', { text: msg }),
    acaoTxt ? h('button', { type: 'button', text: acaoTxt, onclick: () => { t.hidden = true; acao(); } }) : null));
  t.hidden = false;
  clearTimeout(toastT);
  toastT = setTimeout(() => { t.hidden = true; }, ms || (acaoTxt ? 8000 : 4000));
}

/** Botão de duas etapas: o primeiro toque arma, o segundo confirma. */
function armar(btn, rotulo, acao) {
  if (btn.dataset.armado) { clearTimeout(Number(btn.dataset.t)); delete btn.dataset.armado; btn.classList.remove('armado'); btn.textContent = btn.dataset.orig; acao(); return; }
  btn.dataset.orig = btn.textContent;
  btn.dataset.armado = '1';
  btn.classList.add('armado');
  btn.textContent = rotulo;
  btn.dataset.t = String(setTimeout(() => { delete btn.dataset.armado; btn.classList.remove('armado'); btn.textContent = btn.dataset.orig; }, 3500));
}

function numeroLcd(caixa, fantasma, valor, texto) {
  valor.textContent = texto;
  fantasma.textContent = texto.replace(/\d/g, '8');
  caixa.style.setProperty('--len', Math.max(texto.length, 4));
}

const parseNum = (s, max) => {
  s = String(s ?? '').trim().replace(/\s/g, '');
  if (!s) return null;
  if (s.includes(',')) s = s.replace(/\./g, '').replace(',', '.');
  const n = Number(s);
  return Number.isFinite(n) && n > 0 && n <= max ? n : null;
};

const novoId = t => 'p' + Math.round(t).toString(36) + Math.random().toString(36).slice(2, 6);

function tituloPedal(p) {
  if (p.via === 'manual') return p.nota || 'Pedal lançado à mão';
  const hr = new Date(p.inicio).getHours();
  return hr >= 5 && hr < 12 ? 'Pedal da manhã' : hr >= 12 && hr < 18 ? 'Pedal da tarde' : 'Pedal da noite';
}

// ---------- GPS antes de sair (aquecimento) ----------
async function permissaoGps() {
  try { return (await navigator.permissions.query({ name: 'geolocation' })).state; } catch { return 'prompt'; }
}

/** `fundo`: no app Android, segue gravando com a tela apagada (com notificação). */
function ligarGPS(fundo = false) {
  if (!gps.ativa && ['desligado', 'negado', 'indisponivel'].includes(S.gps.estado)) S.gps.estado = 'procurando';
  gps.iniciar(aoLerGps, aoErroGps, { fundo });
  renderGps();
}
function desligarGPS() {
  gps.parar();
  if (!['negado', 'indisponivel'].includes(S.gps.estado)) S.gps.estado = 'desligado';
  S.gps.acc = null;
  renderGps();
}
function aoLerGps(f) {
  S.ultimaLeitura = f;
  if (!S.gpsLiberado) { S.gpsLiberado = true; try { localStorage.setItem('hodometro.gpsLiberado', '1'); } catch { /* ok */ } }
  S.gps.acc = f.acc;
  S.gps.estado = f.acc <= S.cfg.precisao ? 'pronto' : 'fraco';
  if (S.r && !S.demo) processar(f);
  else renderGps();
}
function aoErroGps(e) {
  if (e.code === 1) { S.gps.estado = 'negado'; gps.parar(); }
  else if (e.code === 2) S.gps.estado = 'indisponivel';
  else if (e.code === 0) { S.gps.estado = 'indisponivel'; gps.parar(); }
  // code 3 (demorou) não é erro: o GPS continua tentando
  renderGps();
  if (S.r && !S.demo && e.code === 1) aviso(NATIVO ? 'A localização foi bloqueada. Libere para o Hodômetro nas configurações do Android.' : 'A localização foi bloqueada. Libere nas configurações do navegador para continuar gravando.');
}

async function aquecerGPS() {
  if (S.r || document.hidden || S.tela !== 'pedalar') return;
  let liberado = false;
  if (NATIVO) { try { liberado = localStorage.getItem('hodometro.gpsLiberado') === '1'; } catch { /* ok */ } }
  else liberado = await permissaoGps() === 'granted';
  if (liberado) ligarGPS(false);
}

/** Android 13+: a notificação "Hodômetro gravando" precisa de permissão. */
async function pedirNotificacao() {
  try {
    const st = await chamar('LocalNotifications', 'checkPermissions');
    if (st.display !== 'granted') await chamar('LocalNotifications', 'requestPermissions');
  } catch { /* sem a notificação o serviço ainda grava */ }
}

// ---------- gravação ----------
let relogio = 0;
let quadro = 0;

function agendarPainel() {
  if (quadro) return;
  quadro = requestAnimationFrame(() => { quadro = 0; renderPainel(); });
}

function processar(f) {
  if (!S.r) return;
  tratarEventos(S.r.push(f));
  agendarPainel();
  // Com a tela apagada o relógio da página fica lento; salva também por leitura
  if (!S.demo && Date.now() - S.salvoEm > 15000) salvarAtivo();
}

function tratarEventos(evs) {
  for (const ev of evs) {
    if (ev.tipo === 'km') {
      $('#parcial').textContent = `Km ${ev.km} em ${F.duracao(ev.tempo)}, ${F.kmh(ev.tempo > 0 ? 1000 / ev.tempo : 0)} km/h`;
      if (S.cfg.voz > 0 && ev.km % S.cfg.voz === 0) falar(F.falaKm(ev.km, ev.tempo, ev.media));
    } else if (ev.tipo === 'parou') {
      if (S.cfg.vozPausa) falar('Pausa automática');
    } else if (ev.tipo === 'retomou') {
      if (S.cfg.vozPausa) falar('Retomando');
    } else if (ev.tipo === 'sinal' && ev.sinal === 'fraco') {
      aviso('Sinal do GPS fraco. Pode seguir: o trecho entra quando o sinal voltar.');
    }
  }
}

function iniciarRelogio() {
  clearInterval(relogio);
  relogio = setInterval(() => {
    if (!S.r) return;
    const agora = S.fonte.agora();
    tratarEventos(S.r.tick(agora));
    renderPainel();
    if (!S.demo && Date.now() - S.salvoEm > 5000) salvarAtivo();
    if (S.demo && S.fonte.acabou && !S.demoAvisou) { S.demoAvisou = true; aviso('A simulação chegou ao fim. Toque em Finalizar para ver o resumo.', null, null, 7000); }
  }, 1000);
}

async function salvarAtivo() {
  if (!S.r || S.demo) return;
  S.salvoEm = Date.now();
  try { await A.salvarEstado('ativo', { r: S.r.toJSON(), salvoEm: S.salvoEm }); } catch { /* tenta de novo no próximo ciclo */ }
}

async function manterTela() {
  if (NATIVO || !S.cfg.telaLigada || !S.r) return;
  if (!('wakeLock' in navigator)) { S.wakeFalhou = true; renderPainel(); return; }
  try {
    S.wake = await navigator.wakeLock.request('screen');
    S.wakeFalhou = false;
    S.wake.addEventListener('release', () => { S.wake = null; renderPainel(); });
  } catch { S.wakeFalhou = true; }
  renderPainel();
}
function liberarTela() {
  if (S.wake) S.wake.release().catch(() => {});
  S.wake = null;
}

async function comecar(demo = false) {
  if (S.r || S.iniciando) return;
  if (!demo && NATIVO) {
    S.iniciando = true;
    try { await pedirNotificacao(); } finally { S.iniciando = false; }
    if (S.r) return;
  }
  S.demo = demo;
  S.demoAvisou = false;
  S.fonte = demo ? new FonteSimulada(20) : gps;
  S.r = new Rastreador({ autoPausa: S.cfg.autoPausa, precisaoMax: S.cfg.precisao }, S.fonte.agora());
  if (demo) S.fonte.iniciar(processar);
  else {
    ligarGPS(true);
    // Aproveita a leitura do aquecimento se for de agora há pouco
    const f = S.ultimaLeitura;
    if (f && S.r.inicio - f.t < 1500) processar(f);
  }
  if (S.cfg.voz > 0 || S.cfg.vozPausa) falar(demo ? 'Simulação iniciada.' : 'Gravando o pedal.');
  manterTela();
  A.pedirPersistencia();
  iniciarRelogio();
  salvarAtivo();
  $('#parcial').textContent = 'Parcial a cada 1 km.';
  mostrarTela('pedalar');
  render();
}

function pararGravacao() {
  clearInterval(relogio);
  if (S.demo && S.fonte) S.fonte.parar();
  liberarTela();
  S.r = null; S.fonte = null; S.demo = false;
  desligarGPS();
}

async function finalizar() {
  if (!S.r) return;
  const res = S.r.finalizar(S.fonte.agora());
  const demo = S.demo;
  pararGravacao();
  const pedal = { ...res, id: novoId(res.inicio) };
  if (demo) pedal.demo = true;
  try {
    await A.salvarPedal(pedal);
    await A.apagarEstado('ativo');
  } catch {
    aviso('Não consegui salvar no celular. Exporte o backup antes de fechar o app.');
  }
  S.pedais.push(pedal);
  if (S.cfg.voz > 0) falar(`Pedal finalizado. ${F.km1(pedal.distancia)} quilômetros.`);
  render();
  abrirDetalhe(pedal);
}

// ---------- telas ----------
function mostrarTela(nome) {
  S.tela = nome;
  $('#telaPedalar').hidden = nome !== 'pedalar';
  $('#telaHistorico').hidden = nome !== 'historico';
  $('#telaAjustes').hidden = nome !== 'ajustes';
  $$('#abas button').forEach(b => { if (b.dataset.tela === nome) b.setAttribute('aria-current', 'page'); else b.removeAttribute('aria-current'); });
  if (nome === 'pedalar') aquecerGPS();
  else if (!S.r) desligarGPS();
  render();
  window.scrollTo(0, 0);
}

function render() {
  document.body.classList.toggle('gravando', !!S.r);
  $('#pronto').hidden = !!S.r;
  $('#gravando').hidden = !S.r;
  if (S.r) renderPainel();
  else renderPronto();
  if (S.tela === 'historico') renderHistorico();
  if (S.tela === 'ajustes') renderAjustes();
}

function renderGps() {
  if (S.r) { renderPainel(); return; }
  const g = S.gps;
  const c = $('#gpsCartao');
  c.classList.toggle('procurando', g.estado === 'procurando');
  const n = g.acc == null ? 0 : g.acc <= 5 ? 4 : g.acc <= 10 ? 3 : g.acc <= 20 ? 2 : 1;
  $('#gpsBarras').dataset.n = String(g.estado === 'pronto' || g.estado === 'fraco' ? n : 0);
  const textos = {
    desligado: ['GPS desligado', 'Ative para ver o sinal antes de sair.'],
    procurando: ['Procurando sinal…', 'Fique num lugar aberto. Leva de 5 a 30 segundos.'],
    pronto: ['GPS pronto', `Precisão de ${Math.round(g.acc || 0)} m.`],
    fraco: ['Sinal fraco', `Precisão de ${Math.round(g.acc || 0)} m. Vale esperar um pouco num lugar aberto.`],
    negado: ['Localização bloqueada', NATIVO ? 'Toque em Abrir ajustes e libere a localização do Hodômetro.' : 'Libere a localização para este site nas configurações do navegador.'],
    indisponivel: ['GPS indisponível', 'Confira se a localização do celular está ligada.'],
  };
  const [titulo, sub] = textos[g.estado] || textos.desligado;
  $('#gpsTitulo').textContent = titulo;
  $('#gpsSub').textContent = sub;
  $('#btnGps').hidden = !['desligado', 'negado', 'indisponivel'].includes(g.estado);
  $('#btnGps').textContent = g.estado === 'desligado' ? 'Ativar GPS' : NATIVO && g.estado === 'negado' ? 'Abrir ajustes' : 'Tentar de novo';
  $('#dicaComecar').textContent = g.estado === 'pronto' ? ''
    : 'Pode começar já. A gravação só conta a partir de um sinal bom.';
}

function renderPronto() {
  $('#hojeTxt').textContent = new Date().toLocaleDateString('pt-BR', { weekday: 'long', day: 'numeric', month: 'long' });
  renderGps();
  renderInstalar();

  // Semana
  const dias = F.semana(S.pedais);
  const tot = dias.reduce((a, d) => a + d.distancia, 0);
  $('#semTot').textContent = `${F.km1(tot)} km`;
  const meta = $('#meta');
  if (S.cfg.meta > 0) {
    const pct = Math.min(100, tot / (S.cfg.meta * 1000) * 100);
    const falta = S.cfg.meta * 1000 - tot;
    meta.hidden = false;
    meta.replaceChildren(
      h('div', { class: 'meta-barra', role: 'progressbar', 'aria-valuemin': '0', 'aria-valuemax': '100', 'aria-valuenow': String(Math.round(pct)), 'aria-label': 'Meta da semana' }, h('i', { style: `width:${pct}%` })),
      h('p', { text: falta > 0 ? `${Math.round(pct)}% da meta de ${F.inteiro(S.cfg.meta)} km. Faltam ${F.km1(falta)} km.` : `Meta de ${F.inteiro(S.cfg.meta)} km batida.` }));
  } else meta.hidden = true;

  const hoje = F.chaveDia(Date.now());
  const max = Math.max(5000, ...dias.map(d => d.distancia));
  let iMax = 0; dias.forEach((d, i) => { if (d.distancia > dias[iMax].distancia) iMax = i; });
  if (S.semSel && !dias.some(d => d.chave === S.semSel)) S.semSel = null;
  $('#sem').replaceChildren(...dias.map((d, i) => {
    const eHoje = d.chave === hoje, futuro = d.chave > hoje;
    const mostra = d.distancia > 0 && (eHoje || i === iMax || d.chave === S.semSel);
    const rotulo = `${F.DIAS[d.data.getDay()]} ${F.diaMes(d.data)}: ${F.km1(d.distancia)} km em ${d.n} ${d.n === 1 ? 'pedal' : 'pedais'}`;
    return h('button', {
      type: 'button', class: 'dia' + (eHoje ? ' hoje' : '') + (futuro ? ' futuro' : ''),
      'aria-pressed': String(d.chave === S.semSel), 'aria-label': rotulo, title: rotulo,
      onclick: () => { S.semSel = S.semSel === d.chave ? null : d.chave; renderPronto(); },
    },
    h('span', { class: 'barea' }, d.distancia > 0 ? h('span', { class: 'bar', style: `height:${Math.max(3, d.distancia / max * 100)}%` }, mostra ? h('span', { class: 'v', text: F.km1(d.distancia) }) : null) : null),
    h('span', { class: 'lbl' }, F.DIAS[d.data.getDay()], h('b', { text: String(d.data.getDate()) })));
  }));
  const sel = dias.find(d => d.chave === S.semSel);
  $('#semCap').textContent = sel
    ? `${F.DIAS[sel.data.getDay()]} ${F.diaMes(sel.data)}: ${F.km1(sel.distancia)} km em ${sel.n} ${sel.n === 1 ? 'pedal' : 'pedais'}`
    : S.pedais.length ? 'Toque num dia para ver o total.' : 'Seus km da semana aparecem aqui depois do primeiro pedal.';

  // Último pedal
  const ult = S.pedais.slice().sort((a, b) => b.inicio - a.inicio)[0];
  $('#ultimoBloco').hidden = !ult;
  if (ult) $('#ultimo').replaceChildren(itemPedal(ult));
}

function renderInstalar() {
  const instalado = matchMedia('(display-mode: standalone)').matches || navigator.standalone;
  let fechado = false;
  try { fechado = localStorage.getItem('hodometro.instalarFechado') === '1'; } catch { /* sem acesso */ }
  const caixa = $('#instalar');
  caixa.hidden = NATIVO || instalado || fechado;
  if (caixa.hidden) return;
  const ios = /iphone|ipad|ipod/i.test(navigator.userAgent);
  $('#btnInstalar').hidden = !S.instalar;
  $('#instalarTxt').textContent = S.instalar
    ? 'Fica com ícone na tela inicial, abre em tela cheia e funciona sem internet.'
    : ios
      ? 'No Safari, toque em Compartilhar e depois em "Adicionar à Tela de Início". Assim ele abre em tela cheia e funciona sem internet.'
      : 'No menu do navegador (⋮), toque em "Instalar app" ou "Adicionar à tela inicial". Assim ele abre em tela cheia e funciona sem internet.';
}

function renderPainel() {
  if (!S.r) return;
  const p = S.r.painel(S.fonte.agora());
  numeroLcd($('#velBox'), $('#velFantasma'), $('#vVel'), F.kmh(p.velAtual));
  $('#vDist').textContent = F.kmAoVivo(p.distancia);
  $('#vMov').textContent = F.duracao(p.tempoMov);
  $('#vMedia').textContent = F.kmh(p.velMedia);
  $('#vRitmo').textContent = F.ritmo(p.ritmo);
  $('#vMax').textContent = F.kmh(p.velMax);
  $('#vTotal').textContent = F.duracao(p.tempoTotal);
  $('#vPausas').textContent = String(p.pausas);
  $('#vSubida').textContent = F.inteiro(p.subida);

  let classe = p.estado, txt;
  if (p.estado === 'aguardando') txt = 'Procurando GPS';
  else if (p.estado === 'movendo') txt = 'Gravando';
  else if (p.estado === 'parado') txt = S.r.paradaInicial ? 'Pronto, pode sair' : 'Pausa automática';
  else txt = 'Pausado';
  if (p.sinal === 'fraco' && p.estado !== 'pausado') { classe = 'fraco'; txt = 'Sinal fraco'; }
  if (S.demo && S.fonte.acabou) { classe = 'pausado'; txt = 'Simulação terminou'; }
  $('#status').className = 'status ' + classe;
  $('#statusTxt').textContent = txt;
  const partes = [];
  if (S.demo) partes.push('simulação');
  else if (p.precisao != null && p.precisao < 900) partes.push(`GPS ±${Math.round(p.precisao)} m`);
  if (S.wake) partes.push('tela ligada');
  $('#statusGps').textContent = partes.join(' · ');
  $('#btnPausar').textContent = p.estado === 'pausado' ? 'Continuar' : 'Pausar';

  const avisoTela = $('#avisoTela');
  avisoTela.classList.toggle('neutro', NATIVO);
  if (NATIVO && !S.demo) {
    avisoTela.hidden = false;
    avisoTela.textContent = 'Pode bloquear a tela e guardar o celular. Enquanto grava, fica a notificação "Hodômetro gravando".';
  } else if (S.cfg.telaLigada && S.wakeFalhou && !S.demo) {
    avisoTela.hidden = false;
    avisoTela.textContent = 'Este navegador não deixou manter a tela ligada. Aumente o tempo de tela do celular, senão o GPS para quando ela apagar.';
  } else if (!S.cfg.telaLigada && !S.demo) {
    avisoTela.hidden = false;
    avisoTela.textContent = 'Manter a tela ligada está desativado. Com a tela apagada, o trecho entra em linha reta quando você voltar ao app.';
  } else avisoTela.hidden = true;
}

function itemPedal(p) {
  const d = new Date(p.inicio);
  const meta = [F.duracaoCurta(p.tempoMov), p.tempoMov > 0 ? `${F.kmh(p.distancia / p.tempoMov)} km/h` : null].filter(Boolean).join(' · ');
  return h('button', { type: 'button', class: 'item', onclick: () => abrirDetalhe(p) },
    h('span', { class: 'data' }, h('b', { text: String(d.getDate()) }), h('span', { text: F.DIAS[d.getDay()] })),
    h('span', { class: 'desc' },
      h('b', {}, tituloPedal(p), p.demo ? h('span', { class: 'selo', text: 'demo' }) : null, p.via === 'manual' ? h('span', { class: 'selo', text: 'sem GPS' }) : null),
      h('span', { text: p.via === 'manual' ? meta : `${F.hora(p.inicio)} · ${meta}` })),
    h('span', { class: 'km' }, F.km1(p.distancia), h('small', { text: ' km' })));
}

function renderHistorico() {
  const lista = F.doPeriodo(S.pedais, S.periodo);
  const t = F.somar(lista);
  const rotulos = { semana: 'Semana', mes: 'Mês', ano: 'Ano', total: 'Total' };
  const agora = new Date();
  const ini = F.inicioSemana(agora);
  const aux = {
    semana: `${F.diaMes(ini)} a ${F.diaMes(F.addDias(ini, 6))}`,
    mes: F.MESES[agora.getMonth()],
    ano: String(agora.getFullYear()),
    total: S.pedais.length ? `desde ${F.diaMes(new Date(Math.min(...S.pedais.map(p => p.inicio))))}` : '',
  };
  $('#perRotulo').textContent = rotulos[S.periodo];
  $('#perAux').textContent = aux[S.periodo];
  numeroLcd($('#totBox'), $('#totFantasma'), $('#totKm'), F.km1(t.distancia));
  $('#totN').textContent = String(t.n);
  $('#totMov').textContent = F.horasMin(t.tempoMov);
  $('#totMedia').textContent = t.tempoMov > 0 ? F.kmh(t.velMedia) : '--';
  $$('#modos button').forEach(b => b.setAttribute('aria-selected', String(b.dataset.periodo === S.periodo)));
  $('#histQtd').textContent = S.pedais.length ? `${S.pedais.length} ${S.pedais.length === 1 ? 'pedal' : 'pedais'}` : '';

  // Recordes
  const r = F.recordes(S.pedais);
  const abrir = id => () => { const p = S.pedais.find(x => x.id === id); if (p) abrirDetalhe(p); };
  const rec = (k, v, unid, item, sub) => item
    ? h('button', { type: 'button', onclick: abrir(item.id) }, h('span', { class: 'k', text: k }), h('span', { class: 'v' }, v, unid ? h('small', { text: ' ' + unid }) : null), h('span', { class: 's', text: sub || F.rotuloDia(item.inicio) }))
    : h('div', {}, h('span', { class: 'k', text: k }), h('span', { class: 'v', text: '--' }), h('span', { class: 's', text: 'ainda sem marca' }));
  $('#recordes').replaceChildren(
    rec('Maior distância', r.maiorDistancia && F.km1(r.maiorDistancia.valor), 'km', r.maiorDistancia),
    rec('Maior média', r.maiorMedia && F.kmh(r.maiorMedia.valor), 'km/h', r.maiorMedia, r.maiorMedia && `${F.rotuloDia(r.maiorMedia.inicio)} · 5 km ou mais`),
    rec('Melhor km', r.melhorKm && F.duracao(r.melhorKm.valor), '', r.melhorKm, r.melhorKm && `${F.rotuloDia(r.melhorKm.inicio)} · km ${r.melhorKm.km}`),
    rec('Velocidade máxima', r.maiorVel && F.kmh(r.maiorVel.valor), 'km/h', r.maiorVel));

  // Lista por mês
  const meses = F.porMes(S.pedais);
  $('#lista').replaceChildren(...(meses.length ? meses.map(m => h('div', { class: 'mes' },
    h('h3', {}, h('span', { text: m.rotulo }), h('span', { text: `${F.km1(m.pedais.reduce((a, p) => a + p.distancia, 0))} km` })),
    h('div', { class: 'lista' }, m.pedais.map(itemPedal))))
    : [h('div', { class: 'vazio' }, h('p', { text: 'Nenhum pedal ainda. Grave o primeiro na aba Pedalar ou faça uma simulação em Ajustes.' }))]));

  const mData = $('#mData');
  mData.max = F.chaveDia(Date.now());
  if (!mData.value) mData.value = mData.max;
}

function renderAjustes() {
  $('#cfgAutoPausa').checked = S.cfg.autoPausa;
  $('#cfgTela').checked = S.cfg.telaLigada;
  $('#cfgPrecisao').value = String(S.cfg.precisao);
  $('#cfgVoz').value = String(S.cfg.voz);
  $('#cfgVozPausa').checked = S.cfg.vozPausa;
  if (document.activeElement !== $('#cfgMeta')) $('#cfgMeta').value = S.cfg.meta ? String(S.cfg.meta).replace('.', ',') : '';
  $('#btnTestarVoz').hidden = !temVoz();
  $('#btnDemo').disabled = !!S.r;
  $('#linhaTela').hidden = NATIVO;
  $('#blocoBateria').hidden = !NATIVO;
  if (NATIVO) $('#txtTela').textContent = 'Tela bloqueada: no app Android o GPS continua gravando com a tela apagada e o celular no bolso. Enquanto grava, fica a notificação "Hodômetro gravando".';
  $('#versao').textContent = NATIVO ? `Versão ${VERSAO} do app Android. Funciona sem internet.` : `Versão ${VERSAO}. Funciona offline depois de aberto uma vez.`;
}

// ---------- detalhe ----------
function abrirDetalhe(p) {
  S.detalhe = p;
  const d = $('#detalhe');
  const fim = p.fim || p.inicio + (p.tempoTotal || 0) * 1000;
  $('#dTitulo').textContent = tituloPedal(p);
  $('#dSub').textContent = p.via === 'manual' ? F.dataLonga(p.inicio) : `${F.dataLonga(p.inicio)}, ${F.hora(p.inicio)} às ${F.hora(fim)}`;
  $('#dSelo').replaceChildren(p.demo ? h('span', { class: 'selo', text: 'demonstração' }) : p.via === 'manual' ? h('span', { class: 'selo', text: 'sem GPS' }) : '');

  const cel = (k, v, unid, s) => h('div', {}, h('span', { class: 'k', text: k }), h('span', { class: 'v' }, v, unid ? h('small', { text: ' ' + unid }) : null), s ? h('span', { class: 's', text: s }) : null);
  const media = p.tempoMov > 0 ? p.distancia / p.tempoMov : 0;
  const ritmo = p.distancia >= 50 && p.tempoMov > 0 ? p.tempoMov / (p.distancia / 1000) : null;
  const celulas = [
    cel('Distância', F.km2(p.distancia), 'km'),
    cel('Em movimento', F.duracao(p.tempoMov)),
    cel('Velocidade média', F.kmh(media), 'km/h'),
    cel('Ritmo', F.ritmo(ritmo), '/km'),
  ];
  if (p.via !== 'manual') {
    celulas.push(
      cel('Velocidade máxima', F.kmh(p.velMax), 'km/h'),
      cel('Tempo total', F.duracao(p.tempoTotal), '', 'com as paradas'),
      cel('Pausas', String(p.pausas || 0), '', p.pausas ? `${F.duracaoCurta(p.tempoPausas)} parado` : 'sem paradas'),
      cel('Subida', F.inteiro(p.subida), 'm', 'estimada pelo GPS'));
  }
  $('#dNumeros').replaceChildren(...celulas);

  // Gráfico
  const temPontos = (p.pontos || []).length > 2;
  $('#dGraficoBloco').hidden = !temPontos;
  if (temPontos) $('#dGrafico').replaceChildren(graficoVelocidade(p, $('#dLeitura')));

  // Parciais
  const parc = p.parciais || [];
  $('#dParciaisBloco').hidden = !parc.length;
  if (parc.length) {
    const resto = p.distancia - parc.length * 1000;
    const tResto = p.tempoMov - parc.reduce((a, k) => a + k.tempo, 0);
    const linhas = parc.map(k => ({ rotulo: String(k.km), dist: 1000, tempo: k.tempo }));
    if (resto >= 50 && tResto > 0) linhas.push({ rotulo: `+${F.km2(resto)}`, dist: resto, tempo: tResto, parcial: true });
    const vels = linhas.map(l => l.dist / l.tempo);
    const vMax = Math.max(...vels), melhor = parc.length > 1 ? parc.reduce((m, k, i) => (k.tempo < parc[m].tempo ? i : m), 0) : -1;
    $('#dParciais').replaceChildren(
      h('thead', {}, h('tr', {}, h('th', { text: 'Km' }), h('th', { text: 'Tempo' }), h('th', { class: 'num', text: 'km/h' }), h('th', { text: '' }))),
      h('tbody', {}, linhas.map((l, i) => h('tr', { class: i === melhor ? 'melhor' : null },
        h('td', { text: l.rotulo }),
        h('td', { text: F.duracao(l.tempo) }),
        h('td', { class: 'num', text: F.kmh(vels[i]) }),
        h('td', { class: 'barra' }, h('i', { style: `width:${Math.max(4, vels[i] / vMax * 100)}%` }))))));
  }

  // Notas
  const notas = [];
  const lac = (p.lacunas || []).filter(l => l.dist > 0);
  if (lac.length) notas.push(`Sem sinal em ${lac.length} ${lac.length === 1 ? 'trecho' : 'trechos'}: ${F.km2(lac.reduce((a, l) => a + l.dist, 0))} km somados em linha reta (tracejado no desenho).`);
  if (p.demo) notas.push('Pedal de demonstração, feito pelo simulador.');
  if (p.nota) notas.push(`Nota: ${p.nota}`);
  $('#dNotas').textContent = notas.join(' ');
  $('#dNotas').hidden = !notas.length;
  $('#btnGpx').hidden = !temPontos;
  $('#btnApagar').textContent = 'Apagar pedal';

  const jaAberto = !d.hidden;
  d.hidden = false;
  d.scrollTop = 0;
  document.body.classList.add('sobre');
  if (!jaAberto) history.pushState({ detalhe: p.id }, '');
  requestAnimationFrame(() => desenharTrajeto($('#dMapa'), p));
}

function fecharDetalhe() {
  $('#detalhe').hidden = true;
  document.body.classList.remove('sobre');
  S.detalhe = null;
  render();
}

/**
 * Entrega um arquivo de texto ao usuário. No app Android abre o menu de
 * compartilhar (salvar no Drive, mandar no WhatsApp, abrir no Strava).
 * No navegador, tenta compartilhar e, se não der, baixa.
 */
async function entregarArquivo(texto, nome, tipo) {
  if (NATIVO) {
    try {
      const { uri } = await chamar('Filesystem', 'writeFile', { path: nome, data: texto, directory: 'CACHE', encoding: 'utf8' });
      await chamar('Share', 'share', { title: nome, files: [uri], dialogTitle: 'Salvar ou enviar' });
      return 'compartilhado';
    } catch (e) {
      if (/cancel/i.test(String(e && e.message))) return 'cancelado';
      aviso('Não consegui gerar o arquivo. Tente de novo.');
      return 'erro';
    }
  }
  const blob = new Blob([texto], { type: tipo });
  try {
    const file = new File([blob], nome, { type: tipo });
    if (navigator.canShare && navigator.canShare({ files: [file] })) { await navigator.share({ files: [file], title: nome }); return 'compartilhado'; }
  } catch (e) { if (e && e.name === 'AbortError') return 'cancelado'; }
  const url = URL.createObjectURL(blob);
  const a = h('a', { href: url, download: nome });
  document.body.append(a);
  a.click();
  a.remove();
  setTimeout(() => URL.revokeObjectURL(url), 10000);
  return 'baixado';
}

async function exportarGPX(p) {
  const nome = `${tituloPedal(p)} ${F.diaMes(new Date(p.inicio))}`;
  const arquivo = `pedal-${F.chaveDia(p.inicio)}-${F.hora(p.inicio).replace(':', 'h')}.gpx`;
  const r = await entregarArquivo(gerarGPX(p, nome), arquivo, 'application/gpx+xml');
  if (r === 'baixado') aviso('GPX salvo em Downloads. No Strava, use "Enviar atividade" para importar.');
}

// ---------- eventos ----------
function ligarEventos() {
  $$('#abas button').forEach(b => b.addEventListener('click', () => mostrarTela(b.dataset.tela)));
  $('#btnGps').addEventListener('click', () => {
    if (NATIVO && S.gps.estado === 'negado') { gps.abrirAjustes(); return; }
    S.gps.estado = 'procurando'; gps.parar(); ligarGPS(false);
  });
  $('#btnComecar').addEventListener('click', () => comecar(false));
  $('#btnPausar').addEventListener('click', () => {
    if (!S.r) return;
    const agora = S.fonte.agora();
    if (S.r.estado === 'pausado') { S.r.retomar(agora); aviso('Gravação retomada.'); }
    else { S.r.pausar(agora); aviso('Pausado. O que você andar agora não conta.'); }
    salvarAtivo();
    renderPainel();
  });
  $('#btnFinalizar').addEventListener('click', ev => armar(ev.currentTarget, 'Toque de novo', finalizar));

  $('#btnInstalar').addEventListener('click', async () => {
    if (!S.instalar) return;
    S.instalar.prompt();
    try { await S.instalar.userChoice; } catch { /* fechou */ }
    S.instalar = null;
    renderInstalar();
  });
  $('#btnFecharInstalar').addEventListener('click', () => { try { localStorage.setItem('hodometro.instalarFechado', '1'); } catch { /* ok */ } renderInstalar(); });

  $('#modos').addEventListener('click', ev => {
    const b = ev.target.closest('button[data-periodo]');
    if (!b) return;
    S.periodo = b.dataset.periodo;
    renderHistorico();
  });

  $('#formManual').addEventListener('submit', async ev => {
    ev.preventDefault();
    const msg = $('#mMsg');
    const dia = /^\d{4}-\d{2}-\d{2}$/.test($('#mData').value) ? $('#mData').value : F.chaveDia(Date.now());
    const km = parseNum($('#mKm').value, 500);
    const min = parseNum($('#mMin').value, 1440);
    if (!km) { msg.textContent = 'Informe a distância em km, por exemplo 8,4.'; msg.classList.add('erro'); $('#mKm').focus(); return; }
    if (!min) { msg.textContent = 'Informe quantos minutos você pedalou.'; msg.classList.add('erro'); $('#mMin').focus(); return; }
    const inicio = F.deChaveDia(dia).getTime() + 12 * 3600e3;
    const seg = Math.round(min * 60);
    const p = { versao: 1, via: 'manual', id: novoId(inicio), inicio, fim: inicio + seg * 1000, distancia: Math.round(km * 1000), tempoMov: seg, tempoTotal: seg,
      velMax: 0, subida: 0, pausas: 0, tempoPausas: 0, parciais: [], paradas: [], lacunas: [], pontos: [], nota: $('#mNota').value.trim().slice(0, 60) };
    await A.salvarPedal(p);
    S.pedais.push(p);
    msg.classList.remove('erro');
    msg.textContent = 'Para um pedal que você esqueceu de gravar. Não entra nos recordes.';
    $('#mKm').value = ''; $('#mMin').value = ''; $('#mNota').value = '';
    $('#manual').open = false;
    const quando = F.rotuloDia(inicio);
    aviso(`${F.km1(p.distancia)} km lançados ${quando === 'Hoje' ? 'hoje' : quando === 'Ontem' ? 'ontem' : 'em ' + quando}.`);
    render();
  });

  // Ajustes
  $('#cfgAutoPausa').addEventListener('change', e => { S.cfg.autoPausa = e.target.checked; salvarCfg(); if (S.r) aviso('Vale a partir do próximo pedal.'); });
  $('#cfgTela').addEventListener('change', e => { S.cfg.telaLigada = e.target.checked; salvarCfg(); if (S.r) { if (S.cfg.telaLigada) manterTela(); else liberarTela(); } });
  $('#cfgPrecisao').addEventListener('change', e => { S.cfg.precisao = Number(e.target.value); salvarCfg(); });
  $('#cfgVoz').addEventListener('change', e => { S.cfg.voz = Number(e.target.value); salvarCfg(); });
  $('#cfgVozPausa').addEventListener('change', e => { S.cfg.vozPausa = e.target.checked; salvarCfg(); });
  $('#cfgMeta').addEventListener('change', e => {
    const v = parseNum(e.target.value, 5000);
    S.cfg.meta = v ? Math.round(v * 10) / 10 : 0;
    salvarCfg();
    renderAjustes();
    aviso(S.cfg.meta ? `Meta da semana: ${F.inteiro(S.cfg.meta)} km.` : 'Meta desligada.');
  });
  $('#btnTestarVoz').addEventListener('click', () => {
    if (!falar(F.falaKm(5, 192, 5.4))) aviso('Este navegador não tem voz.');
  });
  $('#btnDemo').addEventListener('click', () => comecar(true));

  $('#btnBackup').addEventListener('click', async () => {
    const dados = { app: 'hodometro', versao: 1, exportadoEm: new Date().toISOString(), ajustes: S.cfg, pedais: S.pedais };
    const r = await entregarArquivo(JSON.stringify(dados), `hodometro-backup-${F.chaveDia(Date.now())}.json`, 'application/json');
    if (r === 'baixado') aviso('Backup salvo em Downloads.');
  });
  $('#arqBackup').addEventListener('change', async e => {
    const arq = e.target.files && e.target.files[0];
    e.target.value = '';
    if (!arq) return;
    try {
      const dados = JSON.parse(await arq.text());
      const lista = Array.isArray(dados) ? dados : dados.pedais;
      if (!Array.isArray(lista)) throw new Error('formato');
      const validos = lista.filter(p => p && typeof p.id === 'string' && Number.isFinite(p.inicio) && Number.isFinite(p.distancia));
      for (const p of validos) await A.salvarPedal(p);
      S.pedais = await A.listarPedais();
      render();
      aviso(`${validos.length} ${validos.length === 1 ? 'pedal importado' : 'pedais importados'}.`);
    } catch {
      aviso('Não consegui ler esse arquivo. Escolha um backup exportado pelo Hodômetro.');
    }
  });
  $('#btnApagarTudo').addEventListener('click', ev => armar(ev.currentTarget, 'Toque de novo para apagar tudo', async () => {
    await A.apagarTodos();
    S.pedais = [];
    render();
    aviso('Todos os pedais foram apagados.');
  }));

  // Detalhe
  $('#btnVoltar').addEventListener('click', () => history.back());
  window.addEventListener('popstate', () => { if (!$('#detalhe').hidden) fecharDetalhe(); });
  $('#btnGpx').addEventListener('click', () => S.detalhe && exportarGPX(S.detalhe));
  $('#btnApagar').addEventListener('click', ev => armar(ev.currentTarget, 'Toque de novo para apagar', async () => {
    const p = S.detalhe;
    if (!p) return;
    await A.apagarPedal(p.id);
    S.pedais = S.pedais.filter(x => x.id !== p.id);
    history.back();
    aviso('Pedal apagado.', 'Desfazer', async () => { await A.salvarPedal(p); S.pedais.push(p); render(); });
  }));
  window.addEventListener('resize', () => { if (S.detalhe) desenharTrajeto($('#dMapa'), S.detalhe); });

  // Ciclo de vida
  document.addEventListener('visibilitychange', () => {
    if (document.visibilityState === 'visible') {
      if (S.r && !S.wake) manterTela();
      aquecerGPS();
      render();
    } else {
      if (S.r) salvarAtivo();
      else desligarGPS();
    }
  });
  window.addEventListener('pagehide', () => { if (S.r) salvarAtivo(); });
  window.addEventListener('beforeinstallprompt', e => { e.preventDefault(); S.instalar = e; renderInstalar(); });
  window.addEventListener('appinstalled', () => { S.instalar = null; renderInstalar(); });
}

// ---------- atualização do app (service worker) ----------
function registrarSW() {
  // No app Android os arquivos já estão no celular; o service worker é só para a versão web
  if (NATIVO || !('serviceWorker' in navigator) || location.protocol === 'file:') return;
  navigator.serviceWorker.register('./sw.js').then(reg => {
    const oferecer = () => {
      if (!reg.waiting) return;
      if (S.r) { setTimeout(oferecer, 60000); return; }
      aviso('Nova versão do app pronta.', 'Atualizar', () => reg.waiting && reg.waiting.postMessage('pular'), 15000);
    };
    if (reg.waiting && navigator.serviceWorker.controller) oferecer();
    reg.addEventListener('updatefound', () => {
      const novo = reg.installing;
      if (novo) novo.addEventListener('statechange', () => { if (novo.state === 'installed' && navigator.serviceWorker.controller) oferecer(); });
    });
  }).catch(() => { /* sem offline nesta visita */ });
  let recarregou = false;
  navigator.serviceWorker.addEventListener('controllerchange', () => {
    if (recarregou || S.r) return;
    recarregou = true;
    location.reload();
  });
}

// ---------- início ----------
async function iniciar() {
  ligarEventos();
  try { S.pedais = await A.listarPedais(); } catch { S.pedais = []; }
  try {
    const ativo = await A.lerEstado('ativo');
    if (ativo && ativo.r) {
      S.r = Rastreador.deJSON(ativo.r);
      S.fonte = gps;
      S.demo = false;
      ligarGPS(true);
      iniciarRelogio();
      manterTela();
      aviso('Pedal em andamento recuperado. O trecho com o app fechado entra em linha reta.', null, null, 7000);
    }
  } catch { /* começa limpo */ }
  mostrarTela('pedalar');
  registrarSW();
}

iniciar();
