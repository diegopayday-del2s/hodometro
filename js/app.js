// Hodômetro: controle das telas, do GPS e da gravação.
import { Rastreador } from './rastreador.js';
import * as F from './formato.js';
import * as A from './armazem.js';
import { FonteGPS, FonteSimulada, FonteNativa } from './fontes.js';
import { ehNativo, chamar } from './nativo.js';
import { falar, temVoz } from './voz.js';
import { vibrar, temVibracao } from './vibra.js';
import { gerarGPX } from './gpx.js';
import { desenharTrajeto, graficoVelocidade } from './desenho.js';

export const VERSAO = '1.2.0';

// No app Android o GPS vem do chip e segue com a tela apagada; no navegador, não
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
const CFG_PADRAO = { v: 2, autoPausa: true, telaWeb: true, precisao: 15, voz: true, vibrar: true, avisoKm: 1, vozPausa: false, meta: 0 };

function lerCfg() {
  let c = {};
  try { c = JSON.parse(localStorage.getItem('hodometro.cfg') || '{}') || {}; } catch { c = {}; }
  if (!c.v) {
    // Ajustes da versão 1.1: "voz" era o intervalo (0, 1, 2 ou 5 km) e a precisão padrão era 25 m
    const vozAntiga = typeof c.voz === 'number' ? c.voz : 1;
    c = { ...c, v: 2, voz: vozAntiga > 0, avisoKm: vozAntiga >= 5 ? 5 : 1, precisao: 15, telaWeb: c.telaLigada ?? true };
    delete c.telaLigada;
  }
  if (![15, 20, 25].includes(c.precisao)) c.precisao = 15;
  if (![1, 5].includes(c.avisoKm)) c.avisoKm = 1;
  return { ...CFG_PADRAO, ...c };
}
function salvarCfg() { try { localStorage.setItem('hodometro.cfg', JSON.stringify(S.cfg)); } catch { /* sem espaço */ } }

const S = {
  cfg: lerCfg(),
  pedais: [],
  tela: 'pedalar',
  telaAntes: 'pedalar',
  r: null,            // Rastreador do pedal em andamento
  fonte: null,        // de onde vêm as leituras do pedal em andamento
  demo: false,
  gps: { estado: 'desligado', acc: null, t: 0, usados: null, vistos: null },
  perm: { local: null, notif: null, bateria: null },
  telaAcesa: false,   // modo guidão
  wake: null,
  wakeFalhou: false,
  instalar: null,
  detalhe: null,
  semSel: null,
  salvoEm: 0,
  notifEm: 0,
  recuperando: false,
  fila: [],
};
const gps = NATIVO ? new FonteNativa() : new FonteGPS();
salvarCfg();

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

/** Diálogo de confirmação. Devolve true se a pessoa confirmou. */
function confirmar(titulo, texto, sim = 'Excluir') {
  const d = $('#dlgConfirma');
  if (typeof d.showModal !== 'function') return Promise.resolve(window.confirm(`${titulo}\n\n${texto}`));
  $('#cfTitulo').textContent = titulo;
  $('#cfTexto').textContent = texto;
  $('#cfSim').textContent = sim;
  d.returnValue = '';
  return new Promise(ok => {
    d.addEventListener('close', () => ok(d.returnValue === 'sim'), { once: true });
    d.showModal();
  });
}

/**
 * Botão de segurar: só dispara depois de `ms` apertado, com a barra enchendo.
 * Soltar antes cancela. Protege o Finalizar de toque sem querer no bolso.
 */
function segurarPara(btn, ms, acao) {
  let timer = 0, disparou = false;
  const soltar = () => { if (!timer) return; clearTimeout(timer); timer = 0; btn.classList.remove('segurando'); };
  const apertar = ev => {
    if (timer) return;
    if (ev.pointerId != null) { try { btn.setPointerCapture(ev.pointerId); } catch { /* sem captura */ } }
    btn.classList.add('segurando');
    timer = setTimeout(() => { timer = 0; disparou = true; btn.classList.remove('segurando'); acao(); }, ms);
  };
  btn.addEventListener('pointerdown', apertar);
  for (const e of ['pointerup', 'pointercancel', 'lostpointercapture']) btn.addEventListener(e, soltar);
  btn.addEventListener('keydown', e => { if ((e.key === 'Enter' || e.key === ' ') && !e.repeat) { e.preventDefault(); apertar(e); } });
  btn.addEventListener('keyup', e => { if (e.key === 'Enter' || e.key === ' ') soltar(); });
  btn.addEventListener('contextmenu', e => e.preventDefault());
  btn.addEventListener('click', e => {
    e.preventDefault();
    if (disparou) { disparou = false; return; }
    if (!timer) aviso('Segure o botão vermelho por 1,5 segundo para finalizar.');
  });
}

const parseNum = (s, max) => {
  s = String(s ?? '').trim().replace(/\s/g, '');
  if (!s) return null;
  if (s.includes(',')) s = s.replace(/\./g, '').replace(',', '.');
  const n = Number(s);
  return Number.isFinite(n) && n > 0 && n <= max ? n : null;
};

const novoId = t => 'p' + Math.round(t).toString(36) + Math.random().toString(36).slice(2, 6);

/** "hoje", "ontem" ou "em sáb, 24/10". */
function emDia(t) {
  const r = F.rotuloDia(t);
  return r === 'Hoje' ? 'hoje' : r === 'Ontem' ? 'ontem' : `em ${r}`;
}

function tituloPedal(p) {
  if (p.via === 'manual') return p.nota || 'Pedal lançado à mão';
  const hr = new Date(p.inicio).getHours();
  return hr >= 5 && hr < 12 ? 'Pedal da manhã' : hr >= 12 && hr < 18 ? 'Pedal da tarde' : 'Pedal da noite';
}

/** Pedal lançado à mão, sem trajeto. `hora` "HH:MM" opcional; sem ela fica ao meio-dia. */
function pedalManual(dia, metros, segundos, nota, hora) {
  const [hh, mm] = /^\d{2}:\d{2}$/.test(hora || '') ? hora.split(':').map(Number) : [12, 0];
  const d = F.deChaveDia(dia);
  const inicio = new Date(d.getFullYear(), d.getMonth(), d.getDate(), hh, mm).getTime();
  return {
    versao: 1, via: 'manual', id: novoId(inicio), inicio, fim: inicio + segundos * 1000,
    distancia: Math.round(metros), tempoMov: segundos, tempoTotal: segundos,
    velMax: 0, subida: 0, pausas: 0, tempoPausas: 0, parciais: [], paradas: [], lacunas: [], pontos: [],
    nota: (nota || '').trim().slice(0, 60), horaInformada: !!hora,
  };
}

// ---------- GPS antes de sair ----------
async function permissaoGps() {
  try { return (await navigator.permissions.query({ name: 'geolocation' })).state; } catch { return 'prompt'; }
}

/** `fundo`: grava em segundo plano (no Android, serviço com notificação). `novo`: pedal novo. */
function ligarGPS(fundo = false, novo = false) {
  if (!gps.ativa || !['pronto', 'fraco'].includes(S.gps.estado)) S.gps.estado = 'procurando';
  const opcoes = { fundo, novo, aoSatelites: s => { S.gps.usados = s.usados; S.gps.vistos = s.vistos; renderGps(); } };
  if (fundo && S.r) Object.assign(opcoes, F.textoNotificacao(S.r.painel(Date.now())));
  gps.iniciar(aoLerGps, aoErroGps, opcoes);
  renderGps();
}
function desligarGPS() {
  gps.parar();
  if (!['negado', 'indisponivel'].includes(S.gps.estado)) S.gps.estado = 'desligado';
  S.gps.acc = null; S.gps.usados = null; S.gps.vistos = null;
  renderGps();
}
function aoLerGps(f) {
  S.ultimaLeitura = f;
  if (!S.gpsLiberado) { S.gpsLiberado = true; try { localStorage.setItem('hodometro.gpsLiberado', '1'); } catch { /* ok */ } }
  S.gps.acc = f.acc;
  S.gps.t = Date.now();
  S.gps.estado = f.acc <= S.cfg.precisao ? 'pronto' : 'fraco';
  if (S.perm.local !== 'granted' && NATIVO) { S.perm.local = 'granted'; renderChecklist(); }
  if (S.r && !S.demo) {
    if (S.recuperando) S.fila.push(f);
    else processar(f);
  } else renderGps();
}
function aoErroGps(e) {
  if (e.code === 1) { S.gps.estado = 'negado'; S.perm.local = 'denied'; gps.parar(); }
  else if (e.code === 2) S.gps.estado = 'indisponivel';
  else if (e.code === 0) { S.gps.estado = 'indisponivel'; gps.parar(); }
  // code 3 (demorou) não é erro: o GPS continua tentando
  renderGps();
  renderChecklist();
  if (S.r && !S.demo) {
    if (e.code === 1) aviso(NATIVO ? 'A localização foi bloqueada. Libere a localização precisa para o Hodômetro nos ajustes do Android.' : 'A localização foi bloqueada. Libere nas configurações do navegador para continuar gravando.');
    else if (e.tipo === 'GPS_DESLIGADO') aviso('A localização do celular está desligada. Ligue de novo para continuar gravando.', 'Ligar', () => gps.abrirAjustes('localizacao'));
  }
}

async function aquecerGPS() {
  if (S.r || document.hidden || S.tela !== 'pedalar') return;
  let liberado = false;
  if (NATIVO) { try { liberado = localStorage.getItem('hodometro.gpsLiberado') === '1'; } catch { /* ok */ } }
  else liberado = await permissaoGps() === 'granted';
  if (liberado) ligarGPS(false);
}

/** Qualidade do sinal para o cartão do GPS. */
function qualidade() {
  const g = S.gps;
  if (['desligado', 'negado', 'indisponivel'].includes(g.estado)) return g.estado;
  if (g.acc == null || Date.now() - g.t > 12000) return 'buscando';
  if (g.acc <= 5) return 'excelente';
  if (g.acc <= 10) return 'bom';
  if (g.acc <= S.cfg.precisao) return 'bom2';
  return 'fraco';
}

// ---------- permissões e bateria (Android) ----------
async function conferirPermissoes() {
  if (!NATIVO) return;
  try { const p = await chamar('Gravador', 'checkPermissions'); S.perm.local = p.localizacao; } catch { /* segue */ }
  try { const n = await chamar('LocalNotifications', 'checkPermissions'); S.perm.notif = n.display; } catch { /* segue */ }
  try { const b = await chamar('Gravador', 'bateria'); S.perm.bateria = !!b.bateriaLivre; } catch { /* segue */ }
  renderChecklist();
}

/** Android 13+: a notificação com os números do pedal precisa de permissão. */
async function pedirNotificacao() {
  try {
    const st = await chamar('LocalNotifications', 'checkPermissions');
    if (st.display === 'granted') { S.perm.notif = 'granted'; return; }
    const r = await chamar('LocalNotifications', 'requestPermissions');
    S.perm.notif = r.display;
  } catch { /* sem a notificação o serviço ainda grava */ }
  renderChecklist();
}

let esperaBateria = 0;
async function pedirBateria() {
  try {
    const r = await chamar('Gravador', 'pedirBateriaLivre');
    S.perm.bateria = !!r.bateriaLivre;
  } catch { gps.abrirAjustes('app'); }
  renderChecklist();
  // O pedido do Android abre por cima do app: confere de novo por meio minuto
  clearInterval(esperaBateria);
  let n = 0;
  esperaBateria = setInterval(async () => {
    n++;
    try { const b = await chamar('Gravador', 'bateria'); S.perm.bateria = !!b.bateriaLivre; } catch { /* segue */ }
    renderChecklist();
    if (S.perm.bateria || n >= 30) clearInterval(esperaBateria);
  }, 1000);
}

// ---------- gravação ----------
let relogio = 0;
let quadro = 0;

function agendarPainel() {
  if (quadro) return;
  quadro = requestAnimationFrame(() => { quadro = 0; renderPainel(); });
}

/** `silencioso`: leituras recuperadas do arquivo, sem voz nem vibração. */
function processar(f, silencioso = false) {
  if (!S.r) return;
  tratarEventos(S.r.push(f), silencioso);
  if (silencioso) return;
  agendarPainel();
  atualizarNotificacao();
  // Com a tela apagada o relógio da página fica lento; salva também por leitura
  if (!S.demo && Date.now() - S.salvoEm > 15000) salvarAtivo();
}

function tratarEventos(evs, silencioso = false) {
  const c = S.cfg;
  for (const ev of evs) {
    if (ev.tipo === 'km') {
      $('#parcial').textContent = `Km ${ev.km} em ${F.duracao(ev.tempo)} · ${F.kmh(ev.tempo > 0 ? 1000 / ev.tempo : 0)} km/h`;
      if (silencioso || ev.km % c.avisoKm !== 0) continue;
      if (c.voz) falar(F.falaKm(ev.km, ev.tempo, ev.media));
      if (c.vibrar) vibrar('km');
    } else if (ev.tipo === 'parou') {
      if (silencioso) continue;
      if (c.vibrar) vibrar('parou');
      if (c.voz && c.vozPausa) falar('Pausa automática.');
      atualizarNotificacao(true);
    } else if (ev.tipo === 'retomou') {
      if (silencioso) continue;
      if (c.vibrar) vibrar('retomou');
      if (c.voz && c.vozPausa) falar('Retomando.');
      atualizarNotificacao(true);
    } else if (ev.tipo === 'sinal' && ev.sinal === 'fraco' && !silencioso) {
      aviso('Sinal do GPS fraco. Pode seguir: o trecho entra quando o sinal voltar.');
    }
  }
}

/** Números da notificação na tela de bloqueio (no máximo a cada 2 s). */
function atualizarNotificacao(agoraJa = false) {
  if (!NATIVO || S.demo || !S.r) return;
  const agora = Date.now();
  if (!agoraJa && agora - S.notifEm < 2000) return;
  S.notifEm = agora;
  const { titulo, texto } = F.textoNotificacao(S.r.painel(agora));
  gps.notificar(titulo, texto);
}

function iniciarRelogio() {
  clearInterval(relogio);
  relogio = setInterval(() => {
    if (!S.r) return;
    const agora = S.fonte.agora();
    tratarEventos(S.r.tick(agora));
    if (!document.hidden) renderPainel();
    atualizarNotificacao();
    if (!S.demo && Date.now() - S.salvoEm > 5000) salvarAtivo();
    if (S.demo && S.fonte.acabou && !S.demoAvisou) { S.demoAvisou = true; aviso('A simulação chegou ao fim. Segure Finalizar para ver o resumo.', null, null, 7000); }
  }, 1000);
}

async function salvarAtivo() {
  if (!S.r || S.demo) return;
  S.salvoEm = Date.now();
  try { await A.salvarEstado('ativo', { r: S.r.toJSON(), salvoEm: S.salvoEm }); } catch { /* tenta de novo no próximo ciclo */ }
}

/**
 * Leituras que o serviço do Android gravou enquanto o app estava fechado ou
 * parado. Entram no motor na ordem, antes das que chegarem agora.
 */
async function recuperarPerdidas() {
  if (!NATIVO || !S.r || S.demo || S.recuperando) return 0;
  S.recuperando = true;
  let n = 0;
  try {
    const lista = await gps.perdidas(S.r.ultimoT ?? S.r.inicio);
    for (const f of lista) { if (!S.r) break; processar(f, true); n++; }
  } catch { /* segue com o que tem */ }
  S.recuperando = false;
  const fila = S.fila;
  S.fila = [];
  for (const f of fila) processar(f);
  if (n && S.r) { salvarAtivo(); renderPainel(); }
  return n;
}

// Modo guidão: tela acesa enquanto grava
async function aplicarTela() {
  const querer = !!S.r && S.telaAcesa;
  if (NATIVO) {
    chamar('Gravador', 'manterTela', { ligada: querer }).catch(() => {});
    renderPainel();
    return;
  }
  if (!querer) { soltarWake(); renderPainel(); return; }
  if (S.wake) return;
  if (!('wakeLock' in navigator)) { S.wakeFalhou = true; renderPainel(); return; }
  try {
    S.wake = await navigator.wakeLock.request('screen');
    S.wakeFalhou = false;
    S.wake.addEventListener('release', () => { S.wake = null; renderPainel(); });
  } catch { S.wakeFalhou = true; }
  renderPainel();
}
function soltarWake() {
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
  if (demo) desligarGPS();
  S.demo = demo;
  S.demoAvisou = false;
  S.fonte = demo ? new FonteSimulada(20) : gps;
  S.r = new Rastreador({ autoPausa: S.cfg.autoPausa, precisaoMax: S.cfg.precisao }, S.fonte.agora());
  S.telaAcesa = !NATIVO && S.cfg.telaWeb;
  if (demo) S.fonte.iniciar(processar);
  else {
    ligarGPS(true, true);
    // Aproveita a leitura do aquecimento se for de agora há pouco
    const f = S.ultimaLeitura;
    if (f && S.r.inicio - f.t < 1500) processar(f);
  }
  if (S.cfg.vibrar) vibrar('inicio');
  if (S.cfg.voz) falar(demo ? 'Simulação iniciada.' : 'Gravando o pedal.');
  aplicarTela();
  A.pedirPersistencia();
  iniciarRelogio();
  salvarAtivo();
  $('#parcial').textContent = avisosTxt();
  mostrarTela('pedalar');
  render();
}

function pararGravacao() {
  clearInterval(relogio);
  if (S.demo && S.fonte) S.fonte.parar();
  S.telaAcesa = false;
  if (NATIVO) chamar('Gravador', 'manterTela', { ligada: false }).catch(() => {});
  else soltarWake();
  S.r = null; S.fonte = null; S.demo = false;
  desligarGPS();
}

async function finalizar() {
  if (!S.r) return;
  const demo = S.demo;
  if (!demo) await recuperarPerdidas();
  if (!S.r) return;
  const res = S.r.finalizar(S.fonte.agora());
  pararGravacao();
  const pedal = { ...res, id: novoId(res.inicio) };
  if (demo) pedal.demo = true;
  let salvo = false;
  try {
    await A.salvarPedal(pedal);
    await A.apagarEstado('ativo');
    salvo = true;
  } catch {
    aviso('Não consegui salvar no celular. Exporte o backup antes de fechar o app.');
  }
  // O arquivo de leituras do Android só sai depois do pedal salvo
  if (salvo && NATIVO && !demo) gps.limpar();
  S.pedais.push(pedal);
  if (S.cfg.vibrar) vibrar('fim');
  if (S.cfg.voz) falar(`Pedal finalizado. ${F.km1(pedal.distancia)} quilômetros.`);
  render();
  abrirDetalhe(pedal);
}

// ---------- telas ----------
function mostrarTela(nome) {
  if (nome === 'ajustes' && S.tela !== 'ajustes') S.telaAntes = S.tela;
  S.tela = nome;
  for (const [t, id] of [['pedalar', '#telaPedalar'], ['historico', '#telaHistorico'], ['estatisticas', '#telaEstatisticas'], ['ajustes', '#telaAjustes']]) $(id).hidden = nome !== t;
  document.body.classList.toggle('ajustes', nome === 'ajustes');
  $$('#abas button').forEach(b => { if (b.dataset.tela === nome) b.setAttribute('aria-current', 'page'); else b.removeAttribute('aria-current'); });
  if (nome === 'pedalar') { aquecerGPS(); conferirPermissoes(); }
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
  if (S.tela === 'estatisticas') renderEstatisticas();
  if (S.tela === 'ajustes') renderAjustes();
}

function renderGps() {
  if (S.r) { renderPainel(); return; }
  const g = S.gps;
  const q = qualidade();
  $('#gpsCartao').dataset.q = q;
  const sat = g.usados != null && g.vistos != null && g.vistos > 0 ? g.usados : null;
  const satTxt = sat != null ? `${sat} ${sat === 1 ? 'satélite' : 'satélites'} em uso` : null;
  const semRede = NATIVO ? 'GPS do aparelho, sem internet.' : '';
  const textos = {
    desligado: ['Desligado', 'Ative para ver o sinal antes de sair.'],
    buscando: ['Buscando', g.vistos ? `${g.vistos} satélites à vista, ${g.usados || 0} em uso. Fique num lugar aberto.` : 'Fique num lugar aberto. Leva de 10 segundos a 1 minuto.'],
    excelente: ['Excelente', [satTxt, semRede].filter(Boolean).join(' · ') || 'Pode sair.'],
    bom: ['Bom', [satTxt, semRede].filter(Boolean).join(' · ') || 'Pode sair.'],
    bom2: ['Bom', satTxt ? `${satTxt}. Num lugar mais aberto fica ainda melhor.` : 'Num lugar mais aberto fica ainda melhor.'],
    fraco: ['Fraco', `Pior que ${S.cfg.precisao} m: o app ignora essas leituras. Vá para um lugar aberto.`],
    negado: ['Bloqueado', NATIVO ? 'Libere a localização precisa para o Hodômetro.' : 'Libere a localização para este site nas configurações do navegador.'],
    indisponivel: ['GPS desligado', 'Ligue a localização do celular.'],
  };
  const [titulo, sub] = textos[q] || textos.desligado;
  $('#gpsTitulo').textContent = titulo;
  $('#gpsSub').textContent = sub;
  $('#gpsMetros').textContent = ['excelente', 'bom', 'bom2', 'fraco'].includes(q) ? `±${Math.round(g.acc)} m` : '';
  const btn = $('#btnGps');
  btn.hidden = !['desligado', 'negado', 'indisponivel'].includes(q);
  btn.textContent = q === 'desligado' ? 'Ativar GPS' : NATIVO && q === 'negado' ? 'Abrir ajustes' : NATIVO && q === 'indisponivel' ? 'Ligar a localização' : 'Tentar de novo';
  $('#dicaComecar').textContent = ['excelente', 'bom', 'bom2'].includes(q) ? ''
    : 'Pode começar já. A gravação só conta a partir de um sinal bom.';
}

function renderChecklist() {
  const caixa = $('#checklist');
  caixa.hidden = !NATIVO || !!S.r;
  if (caixa.hidden) return;
  const linha = (id, ok, txtOk, txtRuim, rotuloBtn, acao) => {
    const el = $(id);
    el.classList.toggle('ruim', !ok);
    el.querySelector('use').setAttribute('href', ok ? '#i-ok' : '#i-alerta');
    el.querySelector('small').textContent = ok ? txtOk : txtRuim;
    const b = el.querySelector('button');
    b.hidden = ok;
    b.textContent = rotuloBtn;
    b.onclick = acao;
  };
  const p = S.perm;
  linha('#chkLocal', p.local === 'granted', 'Liberada.',
    p.local === 'denied' ? 'Bloqueada. Em Permissões, escolha "Permitir durante o uso" e ligue "Usar local exato".' : 'O app pede quando você ativar o GPS.',
    p.local === 'denied' ? 'Abrir ajustes' : 'Liberar',
    () => (p.local === 'denied' ? gps.abrirAjustes('app') : ligarGPS(false)));
  linha('#chkNotif', p.notif === 'granted', 'Distância, tempo e velocidade aparecem com a tela bloqueada.',
    'Sem isso o pedal grava, mas os números não aparecem na tela de bloqueio.',
    p.notif === 'denied' ? 'Abrir ajustes' : 'Liberar',
    async () => { if (p.notif === 'denied') gps.abrirAjustes('notificacoes'); else { await pedirNotificacao(); if (S.perm.notif !== 'granted') gps.abrirAjustes('notificacoes'); } });
  linha('#chkBateria', p.bateria === true, 'Liberada: o Android não corta a gravação no bolso.',
    'A otimização de bateria está ligada. O Android pode parar a gravação com a tela bloqueada.',
    'Liberar', pedirBateria);
}

function avisosTxt() {
  const c = S.cfg;
  const tipos = [c.voz && 'voz', c.vibrar && temVibracao() && 'vibração'].filter(Boolean);
  if (!tipos.length) return 'Sem avisos no bolso. Ligue a voz ou a vibração para saber o km sem olhar.';
  return `Aviso por ${tipos.join(' e ')} a cada ${c.avisoKm} km${c.vibrar && temVibracao() ? ', e vibração quando pausa ou volta' : ''}.`;
}

function renderRapidos() {
  $('#qVoz').setAttribute('aria-pressed', String(!!S.cfg.voz));
  $('#qVoz').hidden = !temVoz();
  $('#qVibra').setAttribute('aria-pressed', String(!!S.cfg.vibrar));
  $('#qVibra').hidden = !temVibracao();
  $$('.seg button[data-km]').forEach(b => b.setAttribute('aria-pressed', String(Number(b.dataset.km) === S.cfg.avisoKm)));
  $('#qTxt').textContent = avisosTxt();
}

function renderPronto() {
  $('#hojeTxt').textContent = new Date().toLocaleDateString('pt-BR', { weekday: 'long', day: 'numeric', month: 'long' });
  renderGps();
  renderChecklist();
  renderRapidos();
  renderInstalar();
  const ult = S.pedais.slice().sort((a, b) => b.inicio - a.inicio)[0];
  $('#ultimoBloco').hidden = !ult;
  if (ult) $('#ultimo').replaceChildren(cardPedal(ult));
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
  $('#vDist').textContent = F.kmAoVivo(p.distancia);
  $('#vVel').textContent = F.kmh(p.velAtual);
  $('#vMov').textContent = F.duracao(p.tempoMov);
  $('#vMedia').textContent = F.kmh(p.velMedia);
  $('#vMax').textContent = F.kmh(p.velMax);
  $('#vSubida').textContent = F.inteiro(p.subida);
  $('#vRitmo').textContent = F.ritmo(p.ritmo);
  $('#vRitmo').classList.toggle('nd', p.ritmo == null);
  $('#vTotal').textContent = F.duracao(p.tempoTotal);
  $('#vPausas').textContent = String(p.pausas);

  let classe = p.estado, txt;
  if (p.estado === 'aguardando') txt = 'Procurando GPS';
  else if (p.estado === 'movendo') txt = 'Gravando';
  else if (p.estado === 'parado') txt = S.r.paradaInicial ? 'Pronto, pode sair' : 'Pausa automática';
  else txt = 'Pausado';
  if (p.sinal === 'fraco' && p.estado !== 'pausado') { classe = 'fraco'; txt = 'Sinal fraco'; }
  if (S.demo && S.fonte.acabou) { classe = 'pausado'; txt = 'Simulação terminou'; }
  $('#status').className = 'status ' + classe;
  $('#statusTxt').textContent = txt;
  for (const e of ['movendo', 'parado', 'pausado', 'aguardando', 'fraco']) document.body.classList.toggle('est-' + e, classe === e);

  const partes = [];
  if (S.demo) partes.push('simulação');
  else {
    if (p.precisao != null && p.precisao < 900) partes.push(`±${Math.round(p.precisao)} m`);
    if (S.gps.usados != null && S.gps.vistos) partes.push(`${S.gps.usados} sat.`);
  }
  $('#statusGps').textContent = partes.join(' · ');

  const telaLigada = NATIVO ? S.telaAcesa : !!S.wake;
  $('#tTela').setAttribute('aria-pressed', String(S.telaAcesa));
  $('#tVoz').setAttribute('aria-pressed', String(!!S.cfg.voz));
  $('#tVoz').hidden = !temVoz();
  $('#tVibra').setAttribute('aria-pressed', String(!!S.cfg.vibrar));
  $('#tVibra').hidden = !temVibracao();

  const pausado = p.estado === 'pausado';
  const bp = $('#btnPausar');
  bp.classList.toggle('continuar', pausado);
  bp.querySelector('span').textContent = pausado ? 'Continuar' : 'Pausar';
  bp.querySelector('use').setAttribute('href', pausado ? '#i-play' : '#i-pausa');

  const avisoTela = $('#avisoTela');
  avisoTela.classList.remove('alerta');
  if (S.demo) avisoTela.hidden = true;
  else if (NATIVO) {
    avisoTela.hidden = false;
    avisoTela.textContent = S.telaAcesa
      ? 'Modo guidão: a tela fica acesa. Toque no sol, lá em cima, para desligar.'
      : 'Pode bloquear a tela e guardar o celular no bolso. Os números ficam na notificação da tela de bloqueio.';
  } else if (S.telaAcesa && S.wakeFalhou) {
    avisoTela.hidden = false;
    avisoTela.classList.add('alerta');
    avisoTela.textContent = 'Este navegador não deixou manter a tela ligada. Aumente o tempo de tela do celular, senão o GPS para quando ela apagar.';
  } else if (!telaLigada) {
    avisoTela.hidden = false;
    avisoTela.classList.add('alerta');
    avisoTela.textContent = 'Tela livre para apagar. No navegador o GPS para com a tela apagada e o trecho entra em linha reta quando você voltar.';
  } else avisoTela.hidden = true;
}

const selo = t => h('span', { class: 'selo', text: t });

function cardPedal(p) {
  const manual = p.via === 'manual';
  const dado = (k, v) => h('span', {}, h('i', { text: k }), h('b', { text: v, class: v === '--' ? 'nd' : null }));
  const quando = manual && !p.horaInformada ? F.rotuloDia(p.inicio) : `${F.rotuloDia(p.inicio)} · ${F.hora(p.inicio)}`;
  return h('button', { type: 'button', class: 'card', onclick: () => abrirDetalhe(p) },
    h('span', { class: 'card-topo' },
      h('b', {}, tituloPedal(p), p.demo ? selo('demo') : null, manual ? selo('sem GPS') : null),
      h('span', { text: quando })),
    h('span', { class: 'card-km' }, F.km2(p.distancia), h('small', { text: 'km' })),
    h('span', { class: 'card-dados' },
      dado('Movimento', p.tempoMov > 0 ? F.duracao(p.tempoMov) : '--'),
      dado('Média', p.tempoMov > 0 ? F.kmh(p.distancia / p.tempoMov) : '--'),
      dado('Máxima', manual ? '--' : F.kmh(p.velMax)),
      dado('Subida', manual ? '--' : `${F.inteiro(p.subida)} m`)));
}

function renderHistorico() {
  $('#histQtd').textContent = S.pedais.length ? `${S.pedais.length} ${S.pedais.length === 1 ? 'pedal' : 'pedais'}` : '';
  const meses = F.porMes(S.pedais);
  $('#lista').replaceChildren(...(meses.length ? meses.map(m => h('section', { class: 'mes' },
    h('h3', {}, h('span', { text: m.rotulo }), h('span', { text: `${F.km1(m.pedais.reduce((a, p) => a + p.distancia, 0))} km` })),
    h('div', { class: 'cards' }, m.pedais.map(cardPedal))))
    : [h('div', { class: 'vazio' }, h('p', { text: 'Nenhum pedal ainda. Grave o primeiro na aba Pedalar ou faça uma simulação em Ajustes.' }))]));
  const mData = $('#mData');
  mData.max = F.chaveDia(Date.now());
  if (!mData.value) mData.value = mData.max;
}

function renderEstatisticas() {
  const e = F.estatisticas(S.pedais);
  const n = x => `${x} ${x === 1 ? 'pedal' : 'pedais'}`;
  $('#estDesde').textContent = e.desde ? `desde ${F.rotuloDia(e.desde)}` : '';
  $('#estKm').textContent = F.km1(e.geral.distancia);
  $('#estResumo').textContent = e.geral.n
    ? `${n(e.geral.n)}${e.geral.tempoMov > 0 ? ` · média de ${F.kmh(e.geral.velMedia)} km/h em movimento` : ''}`
    : 'Nenhum pedal ainda. Os totais aparecem aqui depois do primeiro.';
  $('#estMesKm').textContent = F.km1(e.mes.distancia);
  $('#estMesSub').textContent = e.mes.n ? `${n(e.mes.n)} · ${F.horasLongas(e.mes.tempoMov)}` : F.MESES[new Date().getMonth()];
  $('#estSemKm').textContent = F.km1(e.semana.distancia);
  $('#estSemSub').textContent = e.semana.n ? `${n(e.semana.n)} · ${F.horasLongas(e.semana.tempoMov)}` : 'segunda a domingo';
  $('#estHoras').textContent = F.horasLongas(e.geral.tempoMov);

  // Semana
  const dias = F.semana(S.pedais.filter(p => !p.demo));
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
    const rotulo = `${F.DIAS[d.data.getDay()]} ${F.diaMes(d.data)}: ${F.km1(d.distancia)} km em ${n(d.n)}`;
    return h('button', {
      type: 'button', class: 'dia' + (eHoje ? ' hoje' : '') + (futuro ? ' futuro' : ''),
      'aria-pressed': String(d.chave === S.semSel), 'aria-label': rotulo, title: rotulo,
      onclick: () => { S.semSel = S.semSel === d.chave ? null : d.chave; renderEstatisticas(); },
    },
    h('span', { class: 'barea' }, d.distancia > 0 ? h('span', { class: 'bar', style: `height:${Math.max(3, d.distancia / max * 100)}%` }, mostra ? h('span', { class: 'v', text: F.km1(d.distancia) }) : null) : null),
    h('span', { class: 'lbl' }, F.DIAS[d.data.getDay()], h('b', { text: String(d.data.getDate()) })));
  }));
  const sel = dias.find(d => d.chave === S.semSel);
  $('#semCap').textContent = sel
    ? `${F.DIAS[sel.data.getDay()]} ${F.diaMes(sel.data)}: ${F.km1(sel.distancia)} km em ${n(sel.n)}`
    : S.pedais.length ? 'Toque num dia para ver o total.' : 'Seus km da semana aparecem aqui depois do primeiro pedal.';

  // Recordes
  const r = e.recordes;
  const abrir = id => () => { const p = S.pedais.find(x => x.id === id); if (p) abrirDetalhe(p); };
  const rec = (k, v, unid, item, sub, destaque) => item
    ? h('button', { type: 'button', class: destaque ? 'destaque' : null, onclick: abrir(item.id) }, h('span', { class: 'k', text: k }), h('span', { class: 'v' }, v, unid ? h('small', { text: unid }) : null), h('span', { class: 's', text: sub || F.rotuloDia(item.inicio) }))
    : h('div', {}, h('span', { class: 'k', text: k }), h('span', { class: 'v nd', text: '--' }), h('span', { class: 's', text: 'ainda sem marca' }));
  $('#recordes').replaceChildren(
    rec('Maior pedal', r.maiorDistancia && F.km2(r.maiorDistancia.valor), 'km', r.maiorDistancia, null, true),
    rec('Maior velocidade', r.maiorVel && F.kmh(r.maiorVel.valor), 'km/h', r.maiorVel, null, true),
    rec('Maior média', r.maiorMedia && F.kmh(r.maiorMedia.valor), 'km/h', r.maiorMedia, r.maiorMedia && `${F.rotuloDia(r.maiorMedia.inicio)} · 5 km ou mais`),
    rec('Melhor km', r.melhorKm && F.duracao(r.melhorKm.valor), '', r.melhorKm, r.melhorKm && `${F.rotuloDia(r.melhorKm.inicio)} · km ${r.melhorKm.km}`),
    rec('Maior subida', r.maiorSubida && F.inteiro(r.maiorSubida.valor), 'm', r.maiorSubida));
}

function renderAjustes() {
  $('#cfgAutoPausa').checked = S.cfg.autoPausa;
  $('#cfgTela').checked = S.cfg.telaWeb;
  $('#cfgPrecisao').value = String(S.cfg.precisao);
  $('#cfgVoz').checked = !!S.cfg.voz;
  $('#cfgVibra').checked = !!S.cfg.vibrar;
  $('#cfgAvisoKm').value = String(S.cfg.avisoKm);
  $('#cfgVozPausa').checked = !!S.cfg.vozPausa;
  if (document.activeElement !== $('#cfgMeta')) $('#cfgMeta').value = S.cfg.meta ? String(S.cfg.meta).replace('.', ',') : '';
  $('#btnTestarVoz').hidden = !temVoz();
  $('#btnTestarVibra').hidden = !temVibracao();
  $('#btnDemo').disabled = !!S.r;
  $('#linhaTela').hidden = NATIVO;
  $('#blocoBateria').hidden = !NATIVO;
  $('#btnBateria').textContent = S.perm.bateria ? 'Bateria já liberada' : 'Liberar a bateria';
  if (NATIVO) $('#txtTela').innerHTML = '<b>Tela bloqueada:</b> o app Android grava com a tela apagada e o celular no bolso. Um serviço do Android mantém o GPS e o processador ligados, e a notificação mostra distância, tempo em movimento e velocidade na tela de bloqueio. Se o app for fechado no meio, o serviço continua gravando e o app recupera tudo ao abrir.';
  $('#versao').textContent = NATIVO ? `Versão ${VERSAO} do app Android. Funciona sem internet.` : `Versão ${VERSAO}. Funciona offline depois de aberto uma vez.`;
}

// ---------- resumo do pedal ----------
function abrirDetalhe(p) {
  S.detalhe = p;
  const d = $('#detalhe');
  const manual = p.via === 'manual';
  const fim = p.fim || p.inicio + (p.tempoTotal || 0) * 1000;
  $('#dData').textContent = new Date(p.inicio).toLocaleDateString('pt-BR', { weekday: 'short', day: '2-digit', month: '2-digit', year: 'numeric' });
  $('#dTitulo').textContent = tituloPedal(p);
  $('#dSub').textContent = manual
    ? (p.horaInformada ? `Saída às ${F.hora(p.inicio)} · lançado à mão, sem trajeto` : 'Lançado à mão, sem trajeto')
    : `${F.dataLonga(p.inicio)} · ${F.hora(p.inicio)} às ${F.hora(fim)}`;
  $('#dSelo').replaceChildren(p.demo ? selo('demonstração') : manual ? selo('sem GPS') : '');
  $('#dKm').textContent = F.km2(p.distancia);

  const cel = (k, v, unid) => h('div', {}, h('span', { class: 'k', text: k }), v === '--'
    ? h('span', { class: 'v nd', text: v })
    : h('span', { class: 'v' }, v, unid ? h('small', { text: unid }) : null));
  const media = p.tempoMov > 0 ? p.distancia / p.tempoMov : 0;
  const ritmo = p.distancia >= 50 && p.tempoMov > 0 ? p.tempoMov / (p.distancia / 1000) : null;
  const celulas = [
    cel('Em movimento', p.tempoMov > 0 ? F.duracao(p.tempoMov) : '--'),
    cel('Vel. média', p.tempoMov > 0 ? F.kmh(media) : '--', 'km/h'),
  ];
  if (!manual) {
    celulas.push(
      cel('Vel. máxima', F.kmh(p.velMax), 'km/h'),
      cel('Elevação', F.inteiro(p.subida), 'm'),
      cel('Ritmo', F.ritmo(ritmo), '/km'),
      cel('Tempo total', F.duracao(p.tempoTotal)));
  } else celulas.push(cel('Ritmo', F.ritmo(ritmo), '/km'));
  $('#dNumeros').replaceChildren(...celulas);
  $('#dMapa').hidden = manual;

  const temPontos = (p.pontos || []).length > 2;
  $('#dGraficoBloco').hidden = !temPontos;
  if (temPontos) $('#dGrafico').replaceChildren(graficoVelocidade(p, $('#dLeitura')));

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

  const notas = [];
  const lac = (p.lacunas || []).filter(l => l.dist > 0);
  if (lac.length) notas.push(`Sem sinal em ${lac.length} ${lac.length === 1 ? 'trecho' : 'trechos'}: ${F.km2(lac.reduce((a, l) => a + l.dist, 0))} km somados em linha reta (tracejado no desenho).`);
  if (p.demo) notas.push('Pedal de demonstração, feito pelo simulador. Não entra nas estatísticas.');
  if (manual) notas.push('Lançado à mão: não entra nos recordes.');
  else if (p.nota) notas.push(`Nota: ${p.nota}`);
  $('#dNotas').textContent = notas.join(' ');
  $('#dNotas').hidden = !notas.length;
  $('#btnGpx').hidden = !temPontos;

  const jaAberto = !d.hidden;
  d.hidden = false;
  d.scrollTop = 0;
  document.body.classList.add('sobre');
  if (!jaAberto) history.pushState({ detalhe: p.id }, '');
  if (!manual) requestAnimationFrame(() => desenharTrajeto($('#dMapa'), p));
}

function fecharDetalhe() {
  $('#detalhe').hidden = true;
  document.body.classList.remove('sobre');
  S.detalhe = null;
  render();
  if (S.tela === 'pedalar') aquecerGPS();
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

async function compartilharResumo(p) {
  const texto = F.resumoTexto(p, tituloPedal(p));
  if (NATIVO) {
    try { await chamar('Share', 'share', { title: 'Resumo do pedal', text: texto, dialogTitle: 'Compartilhar resumo' }); }
    catch (e) { if (!/cancel/i.test(String(e && e.message))) aviso('Não consegui abrir o compartilhar. Tente de novo.'); }
    return;
  }
  try {
    if (navigator.share) { await navigator.share({ title: 'Resumo do pedal', text: texto }); return; }
  } catch (e) { if (e && e.name === 'AbortError') return; }
  try { await navigator.clipboard.writeText(texto); aviso('Resumo copiado. Cole no WhatsApp ou onde quiser.'); }
  catch { aviso('Não consegui copiar o resumo.'); }
}

async function excluirPedal(p) {
  const ok = await confirmar('Excluir este pedal?', `${tituloPedal(p)}, ${F.km2(p.distancia)} km, ${F.rotuloDia(p.inicio)}. Ele sai do histórico e das estatísticas.`);
  if (!ok) return;
  await A.apagarPedal(p.id);
  S.pedais = S.pedais.filter(x => x.id !== p.id);
  history.back();
  aviso('Pedal excluído.', 'Desfazer', async () => { await A.salvarPedal(p); S.pedais.push(p); render(); });
}

// ---------- pedal de 24/10 ----------
// Pedal de 24/10/2026 que não ficou gravado inteiro: a distância conhecida é a
// da volta, 3,2 km. Esta versão pergunta uma vez o que lançar no histórico,
// sem inventar trajeto nem tempo. Depois de respondido, não aparece mais.
const LANCAMENTO = { dia: '2026-10-24', metros: 3200, chave: 'hodometro.lancamento-20261024' };

function oferecerLancamento() {
  const d = $('#dlgLancar');
  if (S.r || typeof d.showModal !== 'function' || F.chaveDia(Date.now()) < LANCAMENTO.dia) return;
  try { if (localStorage.getItem(LANCAMENTO.chave)) return; } catch { return; }
  const dia = F.deChaveDia(LANCAMENTO.dia);
  const doDia = S.pedais.filter(p => F.chaveDia(p.inicio) === LANCAMENTO.dia && !p.demo);
  const parecido = doDia.some(p => Math.abs(p.distancia - LANCAMENTO.metros) <= 800);
  $('#lcTitulo').textContent = `Registrar o pedal de ${F.DIAS[dia.getDay()]}, ${F.diaMes(dia)}`;
  $('#lcJa').textContent = doDia.length
    ? `Já salvo neste dia: ${doDia.map(p => `${tituloPedal(p)}, ${F.km2(p.distancia)} km`).join('; ')}.`
    : 'Nada salvo neste dia ainda.';
  const opcoes = parecido
    ? [{ m: LANCAMENTO.metros, sub: 'A ida, que não ficou gravada', nota: 'Ida' }]
    : [{ m: LANCAMENTO.metros, sub: 'Só a volta', nota: 'Volta' }, { m: LANCAMENTO.metros * 2, sub: 'Ida e volta pelo mesmo caminho', nota: 'Ida e volta' }];
  const campoOutra = h('input', { type: 'text', inputmode: 'decimal', autocomplete: 'off', placeholder: 'km, ex.: 4,8', 'aria-label': 'Outra distância em km' });
  $('#lcOpcoes').replaceChildren(
    ...opcoes.map((o, i) => h('label', { class: 'opcao' },
      h('input', { type: 'radio', name: 'lcKm', value: String(o.m), 'data-nota': o.nota, checked: i === 0 }),
      h('span', {}, h('b', { text: `${F.km2(o.m)} km` }), h('span', { text: o.sub })))),
    h('label', { class: 'opcao' },
      h('input', { type: 'radio', name: 'lcKm', value: 'outra', 'data-nota': '' }),
      h('span', {}, h('b', { text: 'Outra distância' }), campoOutra)));
  campoOutra.addEventListener('focus', () => { d.querySelector('input[value="outra"]').checked = true; });
  $('#lcMin').value = '';
  $('#lcHora').value = '';
  d.returnValue = '';
  d.showModal();
}

async function salvarLancamento(ev) {
  const d = $('#dlgLancar');
  const botao = ev.submitter && ev.submitter.value;
  if (botao !== 'sim') { try { localStorage.setItem(LANCAMENTO.chave, 'nao'); } catch { /* ok */ } return; }
  const esc = d.querySelector('input[name="lcKm"]:checked');
  let metros = esc && esc.value !== 'outra' ? Number(esc.value) : null;
  if (esc && esc.value === 'outra') { const km = parseNum(d.querySelector('.opcao input[type="text"]').value, 500); metros = km ? km * 1000 : null; }
  const min = $('#lcMin').value.trim() ? parseNum($('#lcMin').value, 1440) : 0;
  if (!metros || min == null) {
    ev.preventDefault();
    aviso(!metros ? 'Escolha a distância ou digite em km, por exemplo 4,8.' : 'Tempo em minutos, por exemplo 15. Ou deixe vazio.');
    return;
  }
  const p = pedalManual(LANCAMENTO.dia, metros, Math.round(min * 60), esc.dataset.nota || 'Pedal lançado depois', $('#lcHora').value);
  try {
    await A.salvarPedal(p);
    S.pedais.push(p);
    try { localStorage.setItem(LANCAMENTO.chave, 'salvo'); } catch { /* ok */ }
    aviso(`${F.km2(p.distancia)} km lançados ${emDia(p.inicio)}.`);
    render();
  } catch { aviso('Não consegui salvar. Tente de novo pelo Histórico.'); }
}

// ---------- eventos ----------
function alternarVoz() {
  S.cfg.voz = !S.cfg.voz; salvarCfg(); render();
  if (S.cfg.voz) falar('Voz ligada.');
  aviso(S.cfg.voz ? 'Aviso por voz ligado.' : 'Aviso por voz desligado.');
}
function alternarVibracao() {
  S.cfg.vibrar = !S.cfg.vibrar; salvarCfg(); render();
  if (S.cfg.vibrar) vibrar('km');
  aviso(S.cfg.vibrar ? 'Vibração ligada.' : 'Vibração desligada.');
}

function ligarEventos() {
  $$('#abas button').forEach(b => b.addEventListener('click', () => mostrarTela(b.dataset.tela)));
  $('#btnAjustes').addEventListener('click', () => { mostrarTela('ajustes'); history.pushState({ ajustes: true }, ''); });
  $('#btnFecharAjustes').addEventListener('click', () => history.back());
  $('#btnGps').addEventListener('click', () => {
    const q = qualidade();
    if (NATIVO && q === 'negado') { gps.abrirAjustes('app'); return; }
    if (NATIVO && q === 'indisponivel') { gps.abrirAjustes('localizacao'); return; }
    S.gps.estado = 'procurando'; gps.parar(); ligarGPS(false);
  });
  $('#btnComecar').addEventListener('click', () => comecar(false));

  // Avisos rápidos
  $('#qVoz').addEventListener('click', alternarVoz);
  $('#qVibra').addEventListener('click', alternarVibracao);
  $$('.seg button[data-km]').forEach(b => b.addEventListener('click', () => { S.cfg.avisoKm = Number(b.dataset.km); salvarCfg(); render(); }));
  $('#tVoz').addEventListener('click', alternarVoz);
  $('#tVibra').addEventListener('click', alternarVibracao);
  $('#tTela').addEventListener('click', () => {
    S.telaAcesa = !S.telaAcesa;
    if (!NATIVO) { S.cfg.telaWeb = S.telaAcesa; salvarCfg(); }
    aplicarTela();
    aviso(S.telaAcesa ? 'Modo guidão: a tela fica acesa.' : NATIVO ? 'A tela volta a apagar sozinha. A gravação continua.' : 'A tela pode apagar. No navegador o GPS para com ela apagada.');
  });

  $('#btnPausar').addEventListener('click', () => {
    if (!S.r) return;
    const agora = S.fonte.agora();
    if (S.r.estado === 'pausado') { S.r.retomar(agora); aviso('Gravação retomada.'); if (S.cfg.vibrar) vibrar('retomou'); }
    else { S.r.pausar(agora); aviso('Pausado. O que você andar agora não conta.'); if (S.cfg.vibrar) vibrar('parou'); }
    salvarAtivo();
    renderPainel();
    atualizarNotificacao(true);
  });
  segurarPara($('#btnFinalizar'), 1500, () => { if (S.cfg.vibrar) vibrar('toque'); finalizar(); });

  $('#btnInstalar').addEventListener('click', async () => {
    if (!S.instalar) return;
    S.instalar.prompt();
    try { await S.instalar.userChoice; } catch { /* fechou */ }
    S.instalar = null;
    renderInstalar();
  });
  $('#btnFecharInstalar').addEventListener('click', () => { try { localStorage.setItem('hodometro.instalarFechado', '1'); } catch { /* ok */ } renderInstalar(); });

  $('#formManual').addEventListener('submit', async ev => {
    ev.preventDefault();
    const msg = $('#mMsg');
    const dia = /^\d{4}-\d{2}-\d{2}$/.test($('#mData').value) ? $('#mData').value : F.chaveDia(Date.now());
    const km = parseNum($('#mKm').value, 500);
    const temMin = $('#mMin').value.trim() !== '';
    const min = temMin ? parseNum($('#mMin').value, 1440) : 0;
    if (!km) { msg.textContent = 'Informe a distância em km, por exemplo 8,4.'; msg.classList.add('erro'); $('#mKm').focus(); return; }
    if (min == null) { msg.textContent = 'Tempo em minutos, por exemplo 30. Ou deixe vazio.'; msg.classList.add('erro'); $('#mMin').focus(); return; }
    const p = pedalManual(dia, km * 1000, Math.round(min * 60), $('#mNota').value, $('#mHora').value);
    await A.salvarPedal(p);
    S.pedais.push(p);
    msg.classList.remove('erro');
    msg.textContent = 'Para um pedal que você esqueceu de gravar. Não entra nos recordes.';
    $('#mKm').value = ''; $('#mMin').value = ''; $('#mNota').value = ''; $('#mHora').value = '';
    $('#manual').open = false;
    aviso(`${F.km2(p.distancia)} km lançados ${emDia(p.inicio)}.`);
    render();
  });
  $('#formLancar').addEventListener('submit', salvarLancamento);

  // Ajustes
  $('#cfgAutoPausa').addEventListener('change', e => { S.cfg.autoPausa = e.target.checked; salvarCfg(); if (S.r) aviso('Vale a partir do próximo pedal.'); });
  $('#cfgTela').addEventListener('change', e => { S.cfg.telaWeb = e.target.checked; salvarCfg(); });
  $('#cfgPrecisao').addEventListener('change', e => { S.cfg.precisao = Number(e.target.value); salvarCfg(); if (S.r) aviso('Vale a partir do próximo pedal.'); });
  $('#cfgVoz').addEventListener('change', e => { S.cfg.voz = e.target.checked; salvarCfg(); });
  $('#cfgVibra').addEventListener('change', e => { S.cfg.vibrar = e.target.checked; salvarCfg(); if (S.cfg.vibrar) vibrar('km'); });
  $('#cfgAvisoKm').addEventListener('change', e => { S.cfg.avisoKm = Number(e.target.value); salvarCfg(); });
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
  $('#btnTestarVibra').addEventListener('click', () => {
    vibrar('km');
    setTimeout(() => vibrar('parou'), 1600);
    setTimeout(() => vibrar('retomou'), 3200);
    aviso('Km: 2 toques. Pausou: 1 toque longo. Voltou: 3 toques curtos.', null, null, 5000);
  });
  $('#btnBateria').addEventListener('click', pedirBateria);
  $('#btnAjustesApp').addEventListener('click', () => gps.abrirAjustes('app'));
  $('#btnDemo').addEventListener('click', () => { history.back(); setTimeout(() => comecar(true), 50); });

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
  $('#btnApagarTudo').addEventListener('click', async () => {
    if (!S.pedais.length) { aviso('Não há pedais para apagar.'); return; }
    const ok = await confirmar('Apagar todos os pedais?', `${S.pedais.length} ${S.pedais.length === 1 ? 'pedal sai' : 'pedais saem'} deste celular. Exporte um backup antes se quiser guardar.`, 'Apagar tudo');
    if (!ok) return;
    await A.apagarTodos();
    S.pedais = [];
    render();
    aviso('Todos os pedais foram apagados.');
  });

  // Resumo
  $('#btnVoltar').addEventListener('click', () => history.back());
  window.addEventListener('popstate', () => {
    if (!$('#detalhe').hidden) fecharDetalhe();
    else if (S.tela === 'ajustes') mostrarTela(S.telaAntes === 'ajustes' ? 'pedalar' : S.telaAntes);
  });
  $('#btnGpx').addEventListener('click', () => S.detalhe && exportarGPX(S.detalhe));
  $('#btnCompartilhar').addEventListener('click', () => S.detalhe && compartilharResumo(S.detalhe));
  $('#btnApagar').addEventListener('click', () => S.detalhe && excluirPedal(S.detalhe));
  window.addEventListener('resize', () => { if (S.detalhe && S.detalhe.via !== 'manual') desenharTrajeto($('#dMapa'), S.detalhe); });

  // GPS: o cartão mostra "Buscando" se a última leitura ficou velha
  setInterval(() => { if (!S.r && S.tela === 'pedalar' && !document.hidden) renderGps(); }, 2000);

  // Ciclo de vida
  document.addEventListener('visibilitychange', () => {
    if (document.visibilityState === 'visible') {
      if (S.r) {
        if (!NATIVO && S.telaAcesa && !S.wake) aplicarTela();
        if (NATIVO && !S.demo && Date.now() - (S.r.ultimoT || 0) > 5000) recuperarPerdidas();
      }
      aquecerGPS();
      conferirPermissoes();
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
  let recuperou = false;
  try {
    const ativo = await A.lerEstado('ativo');
    if (ativo && ativo.r) {
      S.r = Rastreador.deJSON(ativo.r);
      S.fonte = gps;
      S.demo = false;
      recuperou = true;
    }
  } catch { /* começa limpo */ }
  if (recuperou) {
    // O pedal continuava gravando: liga de novo o GPS e puxa o que o Android gravou sozinho.
    // As leituras novas esperam na fila até as antigas entrarem.
    ligarGPS(true, false);
    const n = await recuperarPerdidas();
    iniciarRelogio();
    aplicarTela();
    aviso(n > 0
      ? `Pedal em andamento recuperado, com ${n} leituras que o Android gravou com o app fechado.`
      : NATIVO ? 'Pedal em andamento recuperado. Pode seguir.' : 'Pedal em andamento recuperado. O trecho com o app fechado entra em linha reta.', null, null, 7000);
  }
  mostrarTela('pedalar');
  registrarSW();
  if (!S.r) setTimeout(oferecerLancamento, 600);
}

iniciar();
