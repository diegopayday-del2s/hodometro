// Controle das telas, do GPS e da gravação.
import { Rastreador } from './rastreador.js';
import * as F from './formato.js';
import * as A from './armazem.js';
import { FonteGPS, FonteSimulada, FonteNativa } from './fontes.js';
import { ehNativo, chamar } from './nativo.js';
import { falar, temVoz } from './voz.js';
import { vibrar, temVibracao } from './vibra.js';
import { gerarGPX, converterGPXEmPedal } from './gpx.js';
import { desenharTrajeto, graficoVelocidade, graficoElevacao } from './desenho.js';
import { trajetoNoMapa, posicaoNoMapa } from './mapa.js';
import { desenharStory, pngBase64 } from './story.js';
import { progresso, resumoProgresso, avaliarMeta, PERIODOS } from './progresso.js';
import { organizarRotas, estatisticasRota, rotaDoPedal, GuiaRota } from './rotas.js';
import { graficoProgresso, histogramaHoras, anel } from './graficos.js';
import { $, $$, h, icone, aviso, confirmar, pedirTexto, segurarPara, quandoAparecer } from './ui.js';
import { NOME_APP } from './marca.js';

export const VERSAO = '1.3.1';

// No app Android o GPS vem do chip e segue com a tela apagada; no navegador, não
const NATIVO = ehNativo();

// ---------- ajustes ----------
const CFG_PADRAO = {
  v: 3, autoPausa: true, telaWeb: true, precisao: 15, voz: true, vibrar: true, avisoKm: 1, vozPausa: false,
  mapa: true, metas: { semana: null, mes: null, ano: null },
};

function lerCfg() {
  let c = {};
  try { c = JSON.parse(localStorage.getItem('hodometro.cfg') || '{}') || {}; } catch { c = {}; }
  if (!c.v) {
    // Versão 1.1: "voz" era o intervalo (0, 1, 2 ou 5 km) e a precisão padrão era 25 m
    const vozAntiga = typeof c.voz === 'number' ? c.voz : 1;
    c = { ...c, v: 2, voz: vozAntiga > 0, avisoKm: vozAntiga >= 5 ? 5 : 1, precisao: 15, telaWeb: c.telaLigada ?? true };
    delete c.telaLigada;
  }
  if (c.v === 2) {
    // Versão 1.2: só havia a meta da semana, em km
    c.metas = { semana: c.meta > 0 ? { tipo: 'distancia', alvo: c.meta } : null, mes: null, ano: null };
    delete c.meta;
    c.mapa = true;
    c.v = 3;
  }
  if (![15, 20, 25].includes(c.precisao)) c.precisao = 15;
  if (![1, 5].includes(c.avisoKm)) c.avisoKm = 1;
  return { ...CFG_PADRAO, ...c, metas: { ...CFG_PADRAO.metas, ...(c.metas || {}) } };
}
function salvarCfg() { try { localStorage.setItem('hodometro.cfg', JSON.stringify(S.cfg)); } catch { /* sem espaço */ } }

const S = {
  cfg: lerCfg(),
  pedais: [],
  rotas: [],
  tentativas: {},
  tela: 'inicio',
  telaAntes: 'inicio',
  sub: 'progresso',
  metrica: 'distancia',
  periodo: 'tri',
  comparar: true,
  r: null,            // Rastreador do pedal em andamento
  fonte: null,        // de onde vêm as leituras do pedal em andamento
  demo: false,
  guia: null,         // rota sendo seguida no pedal em andamento
  rotaEscolhida: null,
  gps: { estado: 'desligado', acc: null, t: 0, usados: null, vistos: null },
  perm: { local: null, notif: null, bateria: null },
  mapaVivo: null,     // última posição desenhada no mapa do Gravar
  telaAcesa: false,   // modo guidão
  modoMapaAoVivo: false,
  ultimoMapaAoVivo: 0,
  wake: null,
  wakeFalhou: false,
  instalar: null,
  detalhe: null,
  rotaAberta: null,
  story: null,
  pilha: [],          // telas por cima (resumo, rota, stories), para o Voltar
  salvoEm: 0,
  notifEm: 0,
  recuperando: false,
  fila: [],
};
const gps = NATIVO ? new FonteNativa() : new FonteGPS();
salvarCfg();

// ---------- utilidades ----------
const parseNum = (s, max) => {
  s = String(s ?? '').trim().replace(/\s/g, '');
  if (!s) return null;
  if (s.includes(',')) s = s.replace(/\./g, '').replace(',', '.');
  const n = Number(s);
  return Number.isFinite(n) && n > 0 && n <= max ? n : null;
};
const novoId = t => 'p' + Math.round(t).toString(36) + Math.random().toString(36).slice(2, 6);
const plural = (n, um, varios) => `${n} ${n === 1 ? um : varios}`;

/** "hoje", "ontem" ou "em sáb, 24/10". */
function emDia(t) {
  const r = F.rotuloDia(t);
  return r === 'Hoje' ? 'hoje' : r === 'Ontem' ? 'ontem' : `em ${r}`;
}

function tituloPedal(p) {
  if (p.nome) return p.nome;
  if (p.via === 'manual') return p.nota || 'Pedal lançado à mão';
  const hr = new Date(p.inicio).getHours();
  return hr >= 5 && hr < 12 ? 'Pedal da manhã' : hr >= 12 && hr < 18 ? 'Pedal da tarde' : 'Pedal da noite';
}
const quandoPedal = p => (p.via === 'manual' && !p.horaInformada ? `${F.quandoLongo(p.inicio, false)} · lançado à mão` : F.quandoLongo(p.inicio));
const temTrajeto = p => (p.pontos || []).length > 2;
const nomeRota = r => r.nome || `Caminho de ${F.km1(r.dist)} km`;
const rotasVisiveis = () => S.rotas.filter(r => !r.oculta);
const rotaDoPedalId = id => S.rotas.find(r => !r.oculta && (S.tentativas[r.id] || []).includes(id)) || null;

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

/** Desenho do trajeto agora e, se tiver internet, o mapa por baixo logo depois. */
function desenharMapaPedal(canvas, pontos, lacunas = []) {
  desenharTrajeto(canvas, { pontos, lacunas: lacunas.map(i => ({ i })) });
  if (S.cfg.mapa) trajetoNoMapa(canvas, pontos, { lacunas });
}

// ---------- rotas ----------
async function carregarRotas() {
  let salvas = [];
  try { salvas = (await A.lerEstado('rotas')) || []; } catch { salvas = []; }
  atualizarRotas(salvas);
}
function atualizarRotas(salvas = S.rotas) {
  const r = organizarRotas(salvas, S.pedais);
  S.rotas = r.rotas;
  S.tentativas = r.tentativas;
  if (r.mudou) salvarRotas();
}
function salvarRotas() { A.salvarEstado('rotas', S.rotas).catch(() => {}); }

/** Posição do pedal entre as tentativas da rota (1 = melhor tempo). */
function posicaoNaRota(rota, p) {
  const lista = (S.tentativas[rota.id] || []).map(id => S.pedais.find(x => x.id === id)).filter(x => x && x.tempoMov > 0).sort((a, b) => a.tempoMov - b.tempoMov);
  const i = lista.findIndex(x => x.id === p.id);
  return i < 0 ? null : i + 1;
}

/** Selos do pedal: rota e recordes. */
function selosPedal(p, comMarcas = true) {
  const selos = [];
  const rota = rotaDoPedalId(p.id);
  if (rota) {
    const pos = posicaoNaRota(rota, p);
    selos.push(h('span', { class: 'selo laranja' }, icone('rota'), `${nomeRota(rota)}${pos === 1 ? ' · melhor tempo' : pos ? ` · ${pos}º tempo` : ''}`));
  }
  const r = F.recordes(S.pedais);
  const varios = S.pedais.filter(x => x.via === 'gps' && !x.demo).length > 1;
  if (varios && r.maiorDistancia && r.maiorDistancia.id === p.id) selos.push(h('span', { class: 'selo laranja' }, icone('trofeu'), 'Maior pedal'));
  if (varios && r.maiorVel && r.maiorVel.id === p.id) selos.push(h('span', { class: 'selo laranja' }, icone('trofeu'), 'Maior velocidade'));
  if (varios && r.maiorMedia && r.maiorMedia.id === p.id) selos.push(h('span', { class: 'selo laranja' }, icone('trofeu'), 'Maior média'));
  if (comMarcas && p.demo) selos.push(h('span', { class: 'selo', text: 'demonstração' }));
  if (comMarcas && p.via === 'manual') selos.push(h('span', { class: 'selo', text: 'sem GPS' }));
  return selos;
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
  } else {
    renderGps();
    atualizarMapaVivo(f);
  }
}
function aoErroGps(e) {
  if (e.code === 1) { S.gps.estado = 'negado'; S.perm.local = 'denied'; gps.parar(); }
  else if (e.code === 2) S.gps.estado = 'indisponivel';
  else if (e.code === 0) { S.gps.estado = 'indisponivel'; gps.parar(); }
  // code 3 (demorou) não é erro: o GPS continua tentando
  renderGps();
  renderChecklist();
  if (S.r && !S.demo) {
    if (e.code === 1) aviso(NATIVO ? 'A localização foi bloqueada. Libere a localização precisa para o app nos ajustes do Android.' : 'A localização foi bloqueada. Libere nas configurações do navegador para continuar gravando.');
    else if (e.tipo === 'GPS_DESLIGADO') aviso('A localização do celular está desligada. Ligue de novo para continuar gravando.', 'Ligar', () => gps.abrirAjustes('localizacao'));
  }
}

async function aquecerGPS() {
  if (S.r || document.hidden || S.tela !== 'gravar' || S.pilha.length) return;
  let liberado = false;
  if (NATIVO) { try { liberado = localStorage.getItem('hodometro.gpsLiberado') === '1'; } catch { /* ok */ } }
  else liberado = await permissaoGps() === 'granted';
  if (liberado) ligarGPS(false);
}

/** Mapa do Gravar centrado em você; redesenha se andou mais de 25 m. */
async function atualizarMapaVivo(f) {
  const caixa = $('#mapaVivoCaixa');
  if (!S.cfg.mapa || S.tela !== 'gravar' || !f) return;
  const m = S.mapaVivo;
  if (m && Math.hypot((f.lat - m.lat) * 111320, (f.lon - m.lon) * 111320 * Math.cos(f.lat * Math.PI / 180)) < 25 && Math.abs(f.acc - m.acc) < 10) return;
  S.mapaVivo = { lat: f.lat, lon: f.lon, acc: f.acc };
  // O mapa só aparece depois de carregado; sem internet fica só o cartão do GPS
  const ok = await posicaoNoMapa($('#mapaVivo'), f.lat, f.lon, f.acc);
  caixa.classList.toggle('sem-mapa', !ok);
  if (!ok) S.mapaVivo = null;
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
  if (S.tela === 'inicio') renderAlerta();
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
    renderAlerta();
    if (S.perm.bateria || n >= 30) clearInterval(esperaBateria);
  }, 1000);
}

/** O que falta para gravar no bolso (Android), na ordem de importância. */
function pendenciaBolso() {
  if (!NATIVO) return null;
  const p = S.perm;
  if (p.local === 'denied') return { txt: 'A localização está bloqueada. Sem ela o app não grava.', btn: 'Abrir ajustes', acao: () => gps.abrirAjustes('app') };
  if (p.bateria === false) return { txt: 'A otimização de bateria está ligada. O Android pode parar a gravação com a tela bloqueada.', btn: 'Liberar', acao: pedirBateria };
  if (p.notif && p.notif !== 'granted') return { txt: 'Sem notificação, os números do pedal não aparecem na tela de bloqueio.', btn: 'Liberar', acao: async () => { await pedirNotificacao(); if (S.perm.notif !== 'granted') gps.abrirAjustes('notificacoes'); renderAlerta(); } };
  return null;
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
  if (S.guia && S.r.estado !== 'pausado' && Number.isFinite(f.acc) && f.acc <= S.cfg.precisao) tratarGuia(S.guia.atualizar(f.lat, f.lon, S.r.tempoMov), silencioso);
  if (silencioso) return;
  agendarPainel();
  atualizarNotificacao();
  // Com a tela apagada o relógio da página fica lento; salva também por leitura
  if (!S.demo && Date.now() - S.salvoEm > 15000) salvarAtivo();
}

/** "0:32 à frente", "0:15 atrás"; falado: "32 segundos à frente do seu melhor." */
function textoDelta(delta, falado = false) {
  if (delta == null) return '';
  const s = Math.abs(delta);
  if (s < 2) return falado ? 'No ritmo do seu melhor tempo.' : 'no ritmo do melhor';
  const t = falado ? F.duracaoFalada(s) : F.duracao(s);
  return delta < 0 ? (falado ? `${t} à frente do seu melhor.` : `${t} à frente`) : (falado ? `${t} atrás do seu melhor.` : `${t} atrás`);
}

function tratarEventos(evs, silencioso = false) {
  const c = S.cfg;
  for (const ev of evs) {
    if (ev.tipo === 'km') {
      $('#parcial').textContent = `Km ${ev.km} em ${F.duracao(ev.tempo)} · ${F.kmh(ev.tempo > 0 ? 1000 / ev.tempo : 0)} km/h`;
      if (silencioso || ev.km % c.avisoKm !== 0) continue;
      if (c.voz) falar(F.falaKm(ev.km, ev.tempo, ev.media) + (S.guia && S.guia.delta != null ? ' ' + textoDelta(S.guia.delta, true) : ''));
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

function tratarGuia(evs, silencioso) {
  if (silencioso || !evs.length) return;
  const c = S.cfg;
  for (const ev of evs) {
    if (ev === 'saiu') {
      if (c.vibrar) vibrar('fora');
      if (c.voz) falar('Você saiu da rota.');
    } else if (ev === 'voltou') {
      if (c.voz) falar('De volta à rota.');
    } else if (ev === 'concluiu') {
      const g = S.guia;
      const recorde = g.melhorTempo && S.r.tempoMov < g.melhorTempo;
      if (c.vibrar) vibrar('fim');
      if (c.voz) falar(`Rota concluída em ${F.duracaoFalada(S.r.tempoMov)}. ${recorde ? 'É o seu melhor tempo!' : g.melhorTempo ? textoDelta(S.r.tempoMov - g.melhorTempo, true) : ''}`);
      aviso(recorde ? 'Rota concluída com o seu melhor tempo!' : 'Rota concluída. Pode seguir ou finalizar o pedal.', null, null, 6000);
    }
  }
  atualizarNotificacao(true);
}

/** Números da notificação na tela de bloqueio (no máximo a cada 2 s). */
function atualizarNotificacao(agoraJa = false) {
  if (!NATIVO || S.demo || !S.r) return;
  const agora = Date.now();
  if (!agoraJa && agora - S.notifEm < 2000) return;
  S.notifEm = agora;
  const g = S.guia;
  const extra = g ? (g.concluida ? 'rota concluída' : g.fora ? 'fora da rota' : `faltam ${F.km2(g.falta)} km da rota`) : '';
  const { titulo, texto } = F.textoNotificacao(S.r.painel(agora), extra);
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
  const g = S.guia;
  const guia = g ? { id: g.rota.id, feito: g.feito, i: g.i, fora: g.fora, concluida: g.concluida } : null;
  try { await A.salvarEstado('ativo', { r: S.r.toJSON(), salvoEm: S.salvoEm, guia }); } catch { /* tenta de novo no próximo ciclo */ }
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

/** Guia da rota escolhida, com o melhor tempo para comparar. */
function criarGuia(idRota) {
  const rota = S.rotas.find(r => r.id === idRota);
  if (!rota) return null;
  const melhor = estatisticasRota(S.tentativas[rota.id] || [], S.pedais).melhor;
  return new GuiaRota(rota, melhor);
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
  S.guia = !demo && S.rotaEscolhida ? criarGuia(S.rotaEscolhida) : null;
  S.telaAcesa = !NATIVO && S.cfg.telaWeb;
  if (demo) S.fonte.iniciar(processar);
  else {
    ligarGPS(true, true);
    // Aproveita a leitura do aquecimento se for de agora há pouco
    const f = S.ultimaLeitura;
    if (f && S.r.inicio - f.t < 1500) processar(f);
  }
  if (S.cfg.vibrar) vibrar('inicio');
  if (S.cfg.voz) falar(demo ? 'Simulação iniciada.' : S.guia ? `Gravando. Rota ${nomeRota(S.guia.rota)}.` : 'Gravando o pedal.');
  aplicarTela();
  A.pedirPersistencia();
  iniciarRelogio();
  salvarAtivo();
  $('#parcial').textContent = avisosTxt();
  mostrarTela('gravar');
}

function pararGravacao() {
  clearInterval(relogio);
  if (S.demo && S.fonte) S.fonte.parar();
  S.telaAcesa = false;
  S.modoMapaAoVivo = false;
  $('#tMapa').setAttribute('aria-pressed', 'false');
  $('.painel-pedal').hidden = false;
  $('#painelMapaAoVivo').hidden = true;
  if (NATIVO) chamar('Gravador', 'manterTela', { ligada: false }).catch(() => {});
  else soltarWake();
  S.r = null; S.fonte = null; S.demo = false; S.guia = null; S.rotaEscolhida = null;
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
  atualizarRotas();
  if (S.cfg.vibrar) vibrar('fim');
  if (S.cfg.voz) falar(`Pedal finalizado. ${F.km1(pedal.distancia)} quilômetros.`);
  mostrarTela('inicio');
  abrirDetalhe(pedal);
}

// ---------- telas ----------
function mostrarTela(nome) {
  if (S.r && nome !== 'gravar') nome = 'gravar';
  if (nome === 'ajustes' && S.tela !== 'ajustes') S.telaAntes = S.tela;
  S.tela = nome;
  for (const [t, id] of [['inicio', '#telaInicio'], ['rotas', '#telaRotas'], ['gravar', '#telaGravar'], ['voce', '#telaVoce'], ['ajustes', '#telaAjustes']]) $(id).hidden = nome !== t;
  document.body.classList.toggle('ajustes', nome === 'ajustes');
  $$('#abas button').forEach(b => { if (b.dataset.tela === nome) b.setAttribute('aria-current', 'page'); else b.removeAttribute('aria-current'); });
  if (nome === 'gravar') { aquecerGPS(); conferirPermissoes(); }
  else if (!S.r) desligarGPS();
  if (nome === 'inicio') conferirPermissoes();
  render();
  window.scrollTo(0, 0);
}

function render() {
  document.body.classList.toggle('gravando', !!S.r);
  $('#pronto').hidden = !!S.r;
  $('#gravando').hidden = !S.r;
  if (S.tela === 'inicio') renderInicio();
  if (S.tela === 'rotas') renderRotas();
  if (S.tela === 'gravar') { if (S.r) renderPainel(); else renderGravar(); }
  if (S.tela === 'voce') renderVoce();
  if (S.tela === 'ajustes') renderAjustes();
}

// ----- Início -----
function renderAlerta() {
  const pend = pendenciaBolso();
  const caixa = $('#alertaBolso');
  caixa.hidden = !pend;
  if (!pend) return;
  $('#alertaTxt').textContent = pend.txt;
  $('#alertaBtn').textContent = pend.btn;
  $('#alertaBtn').onclick = pend.acao;
}

function cardAtividade(p) {
  const manual = p.via === 'manual';
  const dado = (k, v) => h('span', {}, h('i', { text: k }), h('b', { text: v, class: v === '--' ? 'nd' : null }));
  const mapa = temTrajeto(p) ? h('canvas', { class: 'card-mapa', 'aria-label': 'Mapa do trajeto' }) : null;
  const selos = selosPedal(p, false);
  const card = h('button', { type: 'button', class: 'card', onclick: () => abrirDetalhe(p) },
    h('span', { class: 'card-corpo' },
      h('span', { class: 'card-topo' }, h('b', { text: tituloPedal(p) }), h('span', { text: quandoPedal(p) + (p.demo ? ' · demonstração' : '') })),
      h('span', { class: 'card-dados' },
        dado('Distância', `${F.km2(p.distancia)} km`),
        dado('Tempo', p.tempoMov > 0 ? F.tempoCurto(p.tempoMov) : '--'),
        manual ? dado('Vel. média', p.tempoMov > 0 ? `${F.kmh(p.distancia / p.tempoMov)} km/h` : '--') : dado('Elevação', `${F.inteiro(p.subida)} m`)),
      selos.length ? h('span', { class: 'selos' }, selos) : null),
    mapa);
  if (mapa) quandoAparecer(mapa, () => desenharMapaPedal(mapa, p.pontos, (p.lacunas || []).map(l => l.i)));
  return card;
}

function renderInicio() {
  renderAlerta();
  const ini = F.inicioSemana(Date.now());
  const sem = F.somar(F.doPeriodo(S.pedais.filter(p => !p.demo), 'semana'));
  $('#semPeriodo').textContent = `${F.diaMes(ini)} a ${F.diaMes(F.addDias(ini, 6))}`;
  $('#semKm').textContent = `${F.km2(sem.distancia)} km`;
  $('#semTempo').textContent = F.tempoCurto(sem.tempoMov);
  $('#semSubida').textContent = `${F.inteiro(sem.subida)} m`;
  const meta = S.cfg.metas.semana;
  const caixa = $('#semMeta');
  caixa.hidden = !meta;
  if (meta) {
    const m = avaliarMeta(S.pedais, 'semana', meta);
    caixa.replaceChildren(anel(m.fracao, m.batida), h('span', {},
      h('b', { text: m.batida ? 'Meta da semana batida!' : `Faltam ${valorMeta(m.falta, meta.tipo)} para a meta` }),
      h('span', { text: `${valorMeta(m.feito, meta.tipo)} de ${valorMeta(m.alvo, meta.tipo)}` })));
  }
  const lista = S.pedais.slice().sort((a, b) => b.inicio - a.inicio).slice(0, 15);
  $('#feed').replaceChildren(...(lista.length ? lista.map(cardAtividade) : [h('div', { class: 'vazio' },
    h('p', { text: 'Nenhum pedal ainda. Toque em Gravar para o primeiro, ou faça uma simulação em Ajustes.' }),
    h('button', { type: 'button', class: 'btn-pilula', text: 'Gravar', onclick: () => mostrarTela('gravar') }))]));
  renderInstalar();
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

// ----- Rotas -----
function cardRota(r) {
  const e = estatisticasRota(S.tentativas[r.id] || [], S.pedais);
  const dado = (k, v) => h('span', {}, h('i', { text: k }), h('b', { text: v, class: v === '--' ? 'nd' : null }));
  const mapa = h('canvas', { class: 'card-mapa', 'aria-label': 'Mapa da rota' });
  const card = h('button', { type: 'button', class: 'card', onclick: () => abrirRota(r) },
    h('span', { class: 'card-corpo' },
      h('span', { class: 'card-topo' }, h('b', { text: nomeRota(r) }), h('span', { text: `${F.km2(r.dist)} km · ${plural(e.vezes, 'vez', 'vezes')}${e.ultima ? ` · última ${emDia(e.ultima.inicio)}` : ''}` })),
      h('span', { class: 'card-dados' },
        dado('Melhor tempo', e.melhor ? F.duracao(e.melhor.tempoMov) : '--'),
        dado('Tempo médio', e.media ? F.duracao(e.media) : '--'),
        dado('Elevação', `${F.inteiro(r.subida)} m`))),
    mapa);
  quandoAparecer(mapa, () => desenharMapaPedal(mapa, r.linha));
  return card;
}

function renderRotas() {
  const lista = rotasVisiveis().sort((a, b) => (S.tentativas[b.id] || []).length - (S.tentativas[a.id] || []).length);
  const hint = $('#hintRotas');
  if (hint) hint.hidden = lista.length === 0;
  $('#listaRotas').replaceChildren(...(lista.length ? lista.map(cardRota) : [h('div', { class: 'vazio' },
    h('p', { text: 'Nenhuma rota ainda. Quando você repetir um caminho, ele aparece aqui sozinho. Também dá para salvar qualquer pedal como rota, no resumo dele.' }))]));
}

// ----- Gravar -----
function renderGps() {
  if (S.r) { renderPainel(); return; }
  const g = S.gps;
  const q = qualidade();
  $('#gpsCartao').dataset.q = q;
  const sat = g.usados != null && g.vistos != null && g.vistos > 0 ? g.usados : null;
  const satTxt = sat != null ? plural(sat, 'satélite em uso', 'satélites em uso') : null;
  const semRede = NATIVO ? 'sem internet' : '';
  const textos = {
    desligado: ['GPS desligado', 'Ative para ver o sinal antes de sair.'],
    buscando: ['Buscando o GPS', g.vistos ? `${g.vistos} satélites à vista, ${g.usados || 0} em uso. Fique num lugar aberto.` : 'Fique num lugar aberto. Leva de 10 segundos a 1 minuto.'],
    excelente: ['GPS excelente', [satTxt, semRede].filter(Boolean).join(' · ') || 'Pode sair.'],
    bom: ['GPS bom', [satTxt, semRede].filter(Boolean).join(' · ') || 'Pode sair.'],
    bom2: ['GPS bom', satTxt ? `${satTxt}. Num lugar mais aberto fica melhor.` : 'Num lugar mais aberto fica melhor.'],
    fraco: ['GPS fraco', `Pior que ${S.cfg.precisao} m: o app ignora essas leituras. Vá para um lugar aberto.`],
    negado: ['Localização bloqueada', NATIVO ? 'Libere a localização precisa para o app.' : 'Libere a localização para este site nas configurações do navegador.'],
    indisponivel: ['Localização desligada', 'Ligue a localização do celular.'],
  };
  const [titulo, sub] = textos[q] || textos.desligado;
  $('#gpsTitulo').textContent = titulo;
  $('#gpsSub').textContent = sub;
  $('#gpsMetros').textContent = ['excelente', 'bom', 'bom2', 'fraco'].includes(q) ? `±${Math.round(g.acc)} m` : '';
  const btn = $('#btnGps');
  btn.hidden = !['desligado', 'negado', 'indisponivel'].includes(q);
  btn.textContent = q === 'desligado' ? 'Ativar GPS' : NATIVO && q === 'negado' ? 'Abrir ajustes' : NATIVO && q === 'indisponivel' ? 'Ligar a localização' : 'Tentar de novo';
  if (!S.mapaVivo) $('#mapaVivoCaixa').classList.add('sem-mapa');
  $('#dicaComecar').textContent = ['excelente', 'bom', 'bom2'].includes(q) ? ''
    : 'Pode começar já. A gravação só conta a partir de um sinal bom.';
}

function renderChecklist() {
  const caixa = $('#checklist');
  const p = S.perm;
  const tudoOk = p.local === 'granted' && p.notif === 'granted' && p.bateria === true;
  caixa.hidden = !NATIVO || !!S.r || tudoOk;
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

function renderGravar() {
  renderGps();
  renderChecklist();
  $('#qVoz').setAttribute('aria-pressed', String(!!S.cfg.voz));
  $('#qVoz').hidden = !temVoz();
  $('#qVibra').setAttribute('aria-pressed', String(!!S.cfg.vibrar));
  $('#qVibra').hidden = !temVibracao();
  $$('.seg button[data-km]').forEach(b => b.setAttribute('aria-pressed', String(Number(b.dataset.km) === S.cfg.avisoKm)));
  $('#qTxt').textContent = avisosTxt();
  const rota = S.rotaEscolhida && S.rotas.find(r => r.id === S.rotaEscolhida);
  if (S.rotaEscolhida && !rota) S.rotaEscolhida = null;
  $('#btnEscolherRota').classList.toggle('ativa', !!rota);
  $('#rotaEscolhidaTxt').textContent = rota ? `Rota: ${nomeRota(rota)}` : 'Sem rota';
  if (rota) {
    const e = estatisticasRota(S.tentativas[rota.id] || [], S.pedais);
    $('#rotaEscolhidaSub').textContent = `${F.km2(rota.dist)} km${e.melhor ? ` · seu melhor: ${F.duracao(e.melhor.tempoMov)}` : ''}. Toque para trocar.`;
  } else {
    $('#rotaEscolhidaSub').textContent = rotasVisiveis().length ? 'Toque para seguir uma rota e correr contra o seu melhor tempo.' : 'Quando você repetir um caminho, dá para segui-lo aqui.';
  }
}

function escolherRota() {
  const d = $('#dlgRotas');
  const item = (r, sub) => h('button', {
    type: 'button', class: 'opcao' + ((r ? r.id : null) === S.rotaEscolhida ? ' marcada' : ''),
    onclick: () => { S.rotaEscolhida = r ? r.id : null; d.close(); renderGravar(); },
  }, icone('rota'), h('span', {}, h('b', { text: r ? nomeRota(r) : 'Sem rota' }), h('span', { text: sub })));
  $('#erLista').replaceChildren(item(null, 'Grava o pedal sem seguir um caminho.'),
    ...rotasVisiveis().map(r => {
      const e = estatisticasRota(S.tentativas[r.id] || [], S.pedais);
      return item(r, `${F.km2(r.dist)} km · ${plural(e.vezes, 'vez', 'vezes')}${e.melhor ? ` · melhor ${F.duracao(e.melhor.tempoMov)}` : ''}`);
    }));
  if (typeof d.showModal === 'function') d.showModal();
}

function renderMapaAoVivo(forcar = false) {
  const canvas = $('#mapaAoVivoGravando');
  if (!canvas || !S.r) return;
  const agora = Date.now();
  if (!forcar && S.ultimoMapaAoVivo && agora - S.ultimoMapaAoVivo < 1200) return;
  S.ultimoMapaAoVivo = agora;

  const pts = S.r.pontos;
  if (!pts || pts.length < 2) {
    if (S.ultimaLeitura) {
      posicaoNoMapa(canvas, S.ultimaLeitura.lat, S.ultimaLeitura.lon, S.ultimaLeitura.acc);
    }
    return;
  }
  desenharTrajeto(canvas, { pontos: pts, lacunas: S.r.lacunas });
  if (S.cfg.mapa) {
    trajetoNoMapa(canvas, pts, { lacunas: (S.r.lacunas || []).map(l => l.i) });
  }
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

  // Mini painel quando o mapa ao vivo está ativo
  $('#mvDist').textContent = F.kmAoVivo(p.distancia);
  $('#mvVel').textContent = F.kmh(p.velAtual);
  $('#mvMov').textContent = F.duracao(p.tempoMov);
  if (S.modoMapaAoVivo) renderMapaAoVivo();

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

  // Rota sendo seguida
  const g = S.guia;
  $('#guia').hidden = !g;
  if (g) {
    $('#guiaNome').textContent = nomeRota(g.rota);
    const dl = $('#guiaDelta');
    dl.className = g.delta == null || Math.abs(g.delta) < 2 ? '' : g.delta < 0 ? 'frente' : 'atras';
    dl.textContent = g.melhorTempo ? textoDelta(g.delta) : 'primeira vez';
    $('#guiaBarra').style.width = `${(g.fracao * 100).toFixed(1)}%`;
    $('#guiaTxt').textContent = g.concluida ? 'Rota concluída.'
      : g.fora ? `Fora da rota, a ${Math.round(g.longe)} m do caminho.`
        : `Faltam ${F.km2(g.falta)} km de ${F.km2(g.total)} km.`;
  }

  const telaLigada = NATIVO ? S.telaAcesa : !!S.wake;
  $('#tTela').setAttribute('aria-pressed', String(S.telaAcesa));
  $('#tVoz').setAttribute('aria-pressed', String(!!S.cfg.voz));
  $('#tVoz').hidden = !temVoz();
  $('#tVibra').setAttribute('aria-pressed', String(!!S.cfg.vibrar));
  $('#tVibra').hidden = !temVibracao();

  const pausado = p.estado === 'pausado';
  const bp = $('#btnPausar');
  bp.classList.toggle('continuar', pausado);
  bp.querySelector('span').textContent = pausado ? 'Retomar' : 'Pausar';
  bp.querySelector('use').setAttribute('href', pausado ? '#i-play' : '#i-pausa');

  const avisoTela = $('#avisoTela');
  avisoTela.classList.remove('alerta-tela');
  if (S.demo) avisoTela.hidden = true;
  else if (NATIVO) {
    avisoTela.hidden = false;
    avisoTela.textContent = S.telaAcesa
      ? 'Modo guidão: a tela fica acesa. Toque no sol, lá em cima, para desligar.'
      : 'Pode bloquear a tela e guardar o celular no bolso. Os números ficam na notificação da tela de bloqueio.';
  } else if (S.telaAcesa && S.wakeFalhou) {
    avisoTela.hidden = false;
    avisoTela.classList.add('alerta-tela');
    avisoTela.textContent = 'Este navegador não deixou manter a tela ligada. Aumente o tempo de tela do celular, senão o GPS para quando ela apagar.';
  } else if (!telaLigada) {
    avisoTela.hidden = false;
    avisoTela.classList.add('alerta-tela');
    avisoTela.textContent = 'Tela livre para apagar. No navegador o GPS para com a tela apagada e o trecho entra em linha reta quando você voltar.';
  } else avisoTela.hidden = true;
}

// ----- Você -----
const METRICAS = {
  distancia: { titulo: 'Distância total', unid: 'km', conv: v => v / 1000, fmt: v => (v >= 100 ? F.inteiro(v) : F.km1(v * 1000)) },
  tempo: { titulo: 'Tempo em movimento', unid: 'h', conv: v => v / 3600, fmt: v => (v >= 100 ? F.inteiro(v) : F.km1(v * 1000)) },
  subida: { titulo: 'Elevação total', unid: 'm', conv: v => v, fmt: v => F.inteiro(v) },
};

function valorMeta(v, tipo) {
  if (tipo === 'tempo') return F.horasLongas(v);
  if (tipo === 'subida') return `${F.inteiro(v)} m`;
  const km = v / 1000;
  return `${km >= 100 || Math.abs(km - Math.round(km)) < 0.05 ? F.inteiro(km) : F.km1(v)} km`;
}

function renderVoce() {
  $$('.abas-topo button').forEach(b => b.setAttribute('aria-selected', String(b.dataset.sub === S.sub)));
  $('#subProgresso').hidden = S.sub !== 'progresso';
  $('#subAtividades').hidden = S.sub !== 'atividades';
  if (S.sub === 'progresso') renderProgresso();
  else renderAtividades();
}

function renderProgresso() {
  $$('#chipsMetrica button').forEach(b => b.setAttribute('aria-pressed', String(b.dataset.metrica === S.metrica)));
  $$('#chipsPeriodo button').forEach(b => b.setAttribute('aria-pressed', String(b.dataset.periodo === S.periodo)));
  const m = METRICAS[S.metrica];
  const pg = progresso(S.pedais, S.metrica, S.periodo);
  $('#progTitulo').textContent = m.titulo;
  $('#progTotal').textContent = m.fmt(m.conv(pg.total));
  $('#progUnid').textContent = m.unid;
  const vr = $('#progVar');
  if (pg.variacao == null || !S.comparar) { vr.textContent = ''; vr.className = 'var'; }
  else {
    const pct = Math.round(Math.abs(pg.variacao) * 100);
    vr.textContent = pct === 0 ? '= 0%' : `${pg.variacao > 0 ? '▲' : '▼'} ${pct}%`;
    vr.className = 'var ' + (pg.variacao > 0 ? 'sobe' : pg.variacao < 0 ? 'desce' : '');
  }
  // Em 12 meses o período mostra mês e ano; nos outros, dia e mês
  const rotPer = t => (S.periodo === 'ano' ? `${F.MESES[new Date(t).getMonth()].slice(0, 3)}/${String(new Date(t).getFullYear()).slice(2)}` : F.diaMes(new Date(t)));
  $('#progPer').textContent = `${rotPer(pg.ini)} - hoje`;
  $('#progAntCaixa').hidden = !S.comparar;
  $('#progAnt').textContent = `${m.fmt(m.conv(pg.totalAnterior))} ${m.unid}`;
  $('#progPerAnt').textContent = `${rotPer(pg.iniAnterior)} - ${rotPer(F.addDias(new Date(pg.ini), -1).getTime())}`;
  $('#progLeitura').textContent = S.periodo === 'ano' ? 'Toque no gráfico para ver cada mês.' : 'Toque no gráfico para ver cada semana.';
  $('#grafProgresso').replaceChildren(graficoProgresso(pg, { comparar: S.comparar, conv: m.conv, unid: m.unid, fmt: m.fmt, leitura: $('#progLeitura') }));
  $('#btnComparar').setAttribute('aria-pressed', String(S.comparar));
  $('#compararTxt').textContent = S.comparar ? `${PERIODOS[S.periodo].rotulo} anteriores` : `Comparar com os ${PERIODOS[S.periodo].rotulo} anteriores`;
  $('#progResumo').textContent = resumoProgresso(pg);
  renderMetas();
  renderRecordes();
  const validos = S.pedais.filter(p => !p.demo);
  const tot = F.somar(validos);
  const desde = validos.reduce((m2, p) => Math.min(m2, p.inicio), Infinity);
  $('#estDesde').textContent = Number.isFinite(desde) ? `desde ${F.rotuloDia(desde)}` : '';
  $('#estKm').textContent = `${F.km1(tot.distancia)} km`;
  $('#estHoras').textContent = F.tempoCurto(tot.tempoMov);
  $('#estN').textContent = String(tot.n);
}

function renderMetas() {
  const nomes = { semana: 'Esta semana', mes: 'Este mês', ano: 'Este ano' };
  const ate = { mes: 'até o fim do mês', ano: 'até o fim do ano' };
  const itens = [];
  for (const per of ['semana', 'mes', 'ano']) {
    const meta = S.cfg.metas[per];
    if (!meta) continue;
    const m = avaliarMeta(S.pedais, per, meta);
    const linhas = [h('span', { class: 'feito', text: `Concluído: ${valorMeta(m.feito, meta.tipo)} de ${valorMeta(m.alvo, meta.tipo)}` })];
    if (m.batida) linhas.push(h('span', { text: 'Meta batida!' }));
    else {
      const ritmo = per === 'semana' || m.diasRestantes <= 10
        ? ` em ${plural(m.diasRestantes, 'dia', 'dias')}`
        : `: ${valorMeta(m.porSemana, meta.tipo)} por semana ${ate[per]}`;
      linhas.push(h('span', { text: `Faltam ${valorMeta(m.falta, meta.tipo)}${ritmo}` }));
      if (per !== 'semana' && m.projecao > 0) linhas.push(h('span', { text: `No ritmo de agora: ${valorMeta(m.projecao, meta.tipo)}` }));
    }
    itens.push(h('div', { class: 'meta-item' }, anel(m.fracao, m.batida), h('div', {}, h('b', { text: `${nomes[per]} · ${valorMeta(m.alvo, meta.tipo)}` }), ...linhas)));
  }
  $('#metas').replaceChildren(...(itens.length ? itens : [h('div', { class: 'vazio' },
    h('p', { text: 'Defina metas de semana, mês e ano, em km, horas ou subida. O anel mostra quanto falta.' }),
    h('button', { type: 'button', class: 'btn-pilula pequeno', text: 'Definir metas', onclick: abrirMetas }))]));
}

function renderRecordes() {
  const r = F.recordes(S.pedais);
  const abrir = id => () => { const p = S.pedais.find(x => x.id === id); if (p) abrirDetalhe(p); };
  const rec = (k, v, unid, item, sub) => item
    ? h('button', { type: 'button', onclick: abrir(item.id) }, h('span', { class: 'k', text: k }), h('span', { class: 'v' }, v, unid ? h('small', { text: unid }) : null), h('span', { class: 's', text: sub || F.rotuloDia(item.inicio) }))
    : h('div', {}, h('span', { class: 'k', text: k }), h('span', { class: 'v nd', text: '--' }), h('span', { class: 's', text: 'ainda sem marca' }));
  $('#recordes').replaceChildren(
    rec('Maior pedal', r.maiorDistancia && F.km2(r.maiorDistancia.valor), 'km', r.maiorDistancia),
    rec('Maior velocidade', r.maiorVel && F.kmh(r.maiorVel.valor), 'km/h', r.maiorVel),
    rec('Maior média', r.maiorMedia && F.kmh(r.maiorMedia.valor), 'km/h', r.maiorMedia, r.maiorMedia && `${F.rotuloDia(r.maiorMedia.inicio)} · 5 km ou mais`),
    rec('Melhor km', r.melhorKm && F.duracao(r.melhorKm.valor), '', r.melhorKm, r.melhorKm && `${F.rotuloDia(r.melhorKm.inicio)} · km ${r.melhorKm.km}`),
    rec('Maior subida', r.maiorSubida && F.inteiro(r.maiorSubida.valor), 'm', r.maiorSubida));
}

function renderAtividades() {
  const meses = F.porMes(S.pedais);
  $('#lista').replaceChildren(...(meses.length ? meses.map(m => h('section', { class: 'mes' },
    h('h3', {}, h('span', { text: m.rotulo.charAt(0).toUpperCase() + m.rotulo.slice(1) }), h('span', { text: `${F.km1(m.pedais.reduce((a, p) => a + p.distancia, 0))} km · ${plural(m.pedais.length, 'pedal', 'pedais')}` })),
    h('div', { class: 'feed' }, m.pedais.map(cardAtividade))))
    : [h('div', { class: 'vazio' }, h('p', { text: 'Nenhum pedal ainda. Grave o primeiro na aba Gravar ou faça uma simulação em Ajustes.' }))]));
  const mData = $('#mData');
  mData.max = F.chaveDia(Date.now());
  if (!mData.value) mData.value = mData.max;
}

function abrirMetas() {
  const d = $('#dlgMetas');
  for (const [per, id] of [['semana', 'mtSemana'], ['mes', 'mtMes'], ['ano', 'mtAno']]) {
    const m = S.cfg.metas[per];
    $('#' + id).value = m ? String(m.alvo).replace('.', ',') : '';
    $('#' + id + 'Tipo').value = m ? m.tipo : 'distancia';
  }
  if (typeof d.showModal === 'function') d.showModal();
}

function salvarMetas(ev) {
  if (!ev.submitter || ev.submitter.value !== 'sim') return;
  const novas = {};
  for (const [per, id] of [['semana', 'mtSemana'], ['mes', 'mtMes'], ['ano', 'mtAno']]) {
    const txt = $('#' + id).value.trim();
    const v = txt ? parseNum(txt, 100000) : null;
    if (txt && !v) { ev.preventDefault(); aviso('Use só números, por exemplo 30 ou 12,5.'); return; }
    novas[per] = v ? { tipo: $('#' + id + 'Tipo').value, alvo: Math.round(v * 10) / 10 } : null;
  }
  S.cfg.metas = novas;
  salvarCfg();
  render();
  aviso('Metas salvas.');
}

function renderAjustes() {
  $('#cfgAutoPausa').checked = S.cfg.autoPausa;
  $('#cfgTela').checked = S.cfg.telaWeb;
  $('#cfgPrecisao').value = String(S.cfg.precisao);
  $('#cfgMapa').checked = !!S.cfg.mapa;
  $('#cfgVoz').checked = !!S.cfg.voz;
  $('#cfgVibra').checked = !!S.cfg.vibrar;
  $('#cfgAvisoKm').value = String(S.cfg.avisoKm);
  $('#cfgVozPausa').checked = !!S.cfg.vozPausa;
  $('#btnTestarVoz').hidden = !temVoz();
  $('#btnTestarVibra').hidden = !temVibracao();
  $('#btnDemo').disabled = !!S.r;
  $('#linhaTela').hidden = NATIVO;
  $('#blocoBateria').hidden = !NATIVO;
  $('#btnBateria').textContent = S.perm.bateria ? 'Bateria já liberada' : 'Liberar a bateria';
  if (NATIVO) $('#txtTela').innerHTML = '<b>Tela bloqueada:</b> o app Android grava com a tela apagada e o celular no bolso. Um serviço do Android mantém o GPS e o processador ligados, e a notificação mostra distância, tempo em movimento e velocidade na tela de bloqueio. Se o app for fechado no meio, o serviço continua gravando e o app recupera tudo ao abrir.';
  $('#versao').textContent = NATIVO ? `Versão ${VERSAO} do app Android. Funciona sem internet.` : `Versão ${VERSAO}. Funciona offline depois de aberto uma vez.`;
}

// ---------- telas por cima (resumo, rota, stories) ----------
function abrirSobreposta(id) {
  const el = $(id);
  if (!S.pilha.includes(id)) {
    S.pilha.push(id);
    history.pushState({ sobre: id, nivel: S.pilha.length }, '');
  }
  el.style.zIndex = String(30 + S.pilha.indexOf(id));
  el.hidden = false;
  el.scrollTop = 0;
  document.body.classList.add('sobre');
  if (!S.r) desligarGPS();
}
function fecharSobreposta() {
  const id = S.pilha.pop();
  if (id) $(id).hidden = true;
  if (id === '#detalhe') S.detalhe = null;
  if (id === '#rotaDetalhe') S.rotaAberta = null;
  if (id === '#story') S.story = null;
  if (!S.pilha.length) {
    document.body.classList.remove('sobre');
    render();
    aquecerGPS();
  } else if (S.pilha[S.pilha.length - 1] === '#rotaDetalhe' && S.rotaAberta) abrirRota(S.rotaAberta, true);
}

/**
 * Se a tela `id` já está aberta embaixo de outra, volta até ela e depois chama `fn`.
 * Devolve true quando precisou voltar.
 */
function voltarAte(id, fn) {
  const i = S.pilha.indexOf(id);
  if (i < 0 || i === S.pilha.length - 1) return false;
  S.depoisDeVoltar = fn;
  history.go(-(S.pilha.length - 1 - i));
  return true;
}

// ----- Atividade -----
function abrirDetalhe(p) {
  if (voltarAte('#detalhe', () => abrirDetalhe(p))) return;
  S.detalhe = p;
  const manual = p.via === 'manual';
  const fim = p.fim || p.inicio + (p.tempoTotal || 0) * 1000;
  $('#dTitulo').textContent = tituloPedal(p);
  $('#dSub').textContent = manual ? quandoPedal(p) : `${F.quandoLongo(p.inicio)} até ${F.hora(fim)}`;
  $('#dSelo').replaceChildren();
  const cel = (k, v, unid, destaque) => h('div', { class: destaque ? 'destaque' : null }, h('span', { class: 'k', text: k }), v === '--'
    ? h('span', { class: 'v nd', text: v })
    : h('span', { class: 'v' }, v, unid ? h('small', { text: unid }) : null));
  const media = p.tempoMov > 0 ? p.distancia / p.tempoMov : 0;
  const ritmo = p.distancia >= 50 && p.tempoMov > 0 ? p.tempoMov / (p.distancia / 1000) : null;
  const celulas = [
    cel('Distância', F.km2(p.distancia), 'km', true),
    cel('Tempo em movimento', p.tempoMov > 0 ? F.duracao(p.tempoMov) : '--', '', true),
    cel('Vel. média', p.tempoMov > 0 ? F.kmh(media) : '--', 'km/h'),
  ];
  if (!manual) {
    celulas.push(
      cel('Vel. máxima', F.kmh(p.velMax), 'km/h'),
      cel('Ganho de elevação', F.inteiro(p.subida), 'm'),
      cel('Ritmo', F.ritmo(ritmo), '/km'),
      cel('Tempo total', F.duracao(p.tempoTotal)),
      cel('Pausas', String(p.pausas || 0), p.pausas ? `· ${F.tempoCurto(p.tempoPausas)}` : ''));
  } else celulas.push(cel('Ritmo', F.ritmo(ritmo), '/km'));
  $('#dNumeros').replaceChildren(...celulas);
  $('#dSelos').replaceChildren(...selosPedal(p));
  const temPontos = temTrajeto(p);
  const mapa = $('#dMapa');
  mapa.hidden = !temPontos;
  $('#dGraficoBloco').hidden = !temPontos;
  if (temPontos) $('#dGrafico').replaceChildren(graficoVelocidade(p, $('#dLeitura')));

  const elElevBloco = $('#dElevacaoBloco');
  const elElevGraf = $('#dElevacaoGrafico');
  const elElevLeit = $('#dElevacaoLeitura');
  elElevGraf.replaceChildren();
  if (temPontos) {
    const gElev = graficoElevacao(p, elElevLeit);
    if (gElev) {
      elElevGraf.append(gElev);
      elElevBloco.hidden = false;
    } else {
      elElevBloco.hidden = true;
    }
  } else {
    elElevBloco.hidden = true;
  }

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
        h('td', { class: 'barra-p' }, h('i', { style: `width:${Math.max(4, vels[i] / vMax * 100)}%` }))))));
  }

  const notas = [];
  const lac = (p.lacunas || []).filter(l => l.dist > 0);
  if (lac.length) notas.push(`Sem sinal em ${plural(lac.length, 'trecho', 'trechos')}: ${F.km2(lac.reduce((a, l) => a + l.dist, 0))} km somados em linha reta (tracejado no mapa).`);
  if (p.demo) notas.push('Pedal de demonstração, feito pelo simulador. Não entra no progresso nem nas metas.');
  if (manual) notas.push('Lançado à mão: não entra nos recordes.');
  else if (p.nota) notas.push(`Nota: ${p.nota}`);
  $('#dNotas').textContent = notas.join(' ');
  $('#dNotas').hidden = !notas.length;
  $('#btnGpx').hidden = !temPontos;
  const rota = rotaDoPedalId(p.id);
  $('#btnSalvarRota').hidden = !temPontos || p.demo;
  $('#btnSalvarRota').textContent = rota ? 'Ver a rota' : 'Salvar como rota';

  abrirSobreposta('#detalhe');
  if (temPontos) requestAnimationFrame(() => desenharMapaPedal(mapa, p.pontos, (p.lacunas || []).map(l => l.i)));
}

async function renomearPedal() {
  const p = S.detalhe;
  if (!p) return;
  const nome = await pedirTexto('Nome do pedal', tituloPedal(p), 'Por exemplo: Lavrinha com a turma.');
  if (nome == null) return;
  if (nome) p.nome = nome.slice(0, 60);
  else delete p.nome;
  await A.salvarPedal(p);
  $('#dTitulo').textContent = tituloPedal(p);
  aviso('Nome salvo.');
}

async function salvarComoRota() {
  const p = S.detalhe;
  if (!p) return;
  const ja = rotaDoPedalId(p.id);
  if (ja) { abrirRota(ja); return; }
  const r = rotaDoPedal(p, false);
  if (!r) { aviso('Este pedal não tem trajeto suficiente para virar rota.'); return; }
  const nome = await pedirTexto('Nome da rota', `Caminho de ${F.km1(r.dist)} km`, 'Por exemplo: Ida pra Lavrinha.');
  if (nome == null) return;
  r.nome = nome.slice(0, 60) || null;
  S.rotas.push(r);
  atualizarRotas();
  salvarRotas();
  $('#btnSalvarRota').textContent = 'Ver a rota';
  $('#dSelos').replaceChildren(...selosPedal(p));
  aviso('Rota salva. Para segui-la, escolha a rota em Gravar.');
}

// ----- Rota -----
function abrirRota(r, soAtualizar = false) {
  if (!soAtualizar && voltarAte('#rotaDetalhe', () => abrirRota(r))) return;
  S.rotaAberta = r;
  const e = estatisticasRota(S.tentativas[r.id] || [], S.pedais);
  $('#rTitulo').textContent = nomeRota(r);
  $('#rLinha').textContent = `${F.km2(r.dist)} km · ${plural(e.vezes, 'vez', 'vezes')} · ${F.inteiro(r.subida)} m de subida`;
  const cel = (k, v, unid) => h('div', {}, h('span', { class: 'k', text: k }), v === '--' ? h('span', { class: 'v nd', text: v }) : h('span', { class: 'v' }, v, unid ? h('small', { text: unid }) : null));
  $('#rNumeros').replaceChildren(
    cel('Melhor tempo', e.melhor ? F.duracao(e.melhor.tempoMov) : '--'),
    cel('Tempo médio', e.media ? F.duracao(e.media) : '--'),
    cel('Vel. no melhor', e.melhor ? F.kmh(e.melhor.distancia / e.melhor.tempoMov) : '--', 'km/h'),
    cel('Última vez', e.ultima ? F.rotuloDia(e.ultima.inicio) : '--'));
  const pico = e.horas.reduce((m, v, i) => (v > e.horas[m] ? i : m), 0);
  $('#rHorasTxt').textContent = e.vezes
    ? `Você costuma sair entre ${pico}h e ${pico + 1}h. A barra laranja é a hora de agora.`
    : 'Os horários aparecem depois da primeira vez nesta rota.';
  $('#rHoras').replaceChildren(histogramaHoras(e.horas));

  const rElevBloco = $('#rElevacaoBloco');
  const rElevGraf = $('#rElevacaoGrafico');
  const rElevLeit = $('#rElevacaoLeitura');
  rElevGraf.replaceChildren();
  const pedalComAlt = (e.pedais || []).find(p => p.pontos && p.pontos.some(pt => Number.isFinite(pt[3])));
  if (pedalComAlt) {
    const gElev = graficoElevacao(pedalComAlt, rElevLeit);
    if (gElev) {
      rElevGraf.append(gElev);
      rElevBloco.hidden = false;
    } else {
      rElevBloco.hidden = true;
    }
  } else {
    rElevBloco.hidden = true;
  }

  const ordem = e.pedais.filter(p => p.tempoMov > 0).sort((a, b) => a.tempoMov - b.tempoMov).map(p => p.id);
  const medalha = ['ouro', 'prata', 'bronze'];
  $('#rTentativas').replaceChildren(...(e.pedais.length ? e.pedais.slice().reverse().map(p => {
    const pos = ordem.indexOf(p.id);
    return h('button', { type: 'button', class: 'tentativa', onclick: () => abrirDetalhe(p) },
      h('span', { class: 'pos ' + (pos >= 0 && pos < 3 ? medalha[pos] : ''), text: pos >= 0 ? `${pos + 1}º` : '-' }),
      h('span', {}, h('b', { text: tituloPedal(p) }), h('span', { text: `${F.quandoLongo(p.inicio)} · ${F.kmh(p.tempoMov > 0 ? p.distancia / p.tempoMov : 0)} km/h` })),
      h('b', { text: p.tempoMov > 0 ? F.duracao(p.tempoMov) : '--' }));
  }) : [h('p', { class: 'hint', text: 'Ainda sem tentativas. Toque em Pedalar esta rota.' })]));
  if (!soAtualizar) abrirSobreposta('#rotaDetalhe');
  requestAnimationFrame(() => desenharMapaPedal($('#rMapa'), r.linha));
}

async function renomearRota() {
  const r = S.rotaAberta;
  if (!r) return;
  const nome = await pedirTexto('Nome da rota', nomeRota(r), 'Por exemplo: Ida pra Lavrinha.');
  if (nome == null) return;
  r.nome = nome.slice(0, 60) || null;
  r.auto = false;
  salvarRotas();
  $('#rTitulo').textContent = nomeRota(r);
  aviso('Nome salvo.');
}

async function excluirRota() {
  const r = S.rotaAberta;
  if (!r) return;
  const ok = await confirmar('Excluir esta rota?', `${nomeRota(r)} sai da lista. Os pedais continuam no histórico.`);
  if (!ok) return;
  // Fica guardada como oculta, para os mesmos pedais não criarem a rota de novo
  r.oculta = true;
  r.auto = false;
  if (S.rotaEscolhida === r.id) S.rotaEscolhida = null;
  salvarRotas();
  history.back();
  aviso('Rota excluída.');
}

// ----- Stories -----
async function abrirStory(p) {
  S.story = { pedal: p, modelo: 'laranja', foto: null };
  abrirSobreposta('#story');
  await renderStory();
}
async function renderStory() {
  const st = S.story;
  if (!st) return;
  $$('#story [data-modelo]').forEach(b => b.setAttribute('aria-pressed', String(b.dataset.modelo === st.modelo)));
  $('#btnFoto').hidden = st.modelo !== 'foto';
  $('#storyDica').textContent = st.modelo === 'transparente'
    ? 'Fundo transparente: no Instagram, cole por cima de uma foto sua.'
    : st.modelo === 'foto' ? (st.foto ? 'Pronto. Troque a foto quando quiser.' : 'Escolha uma foto da galeria para o fundo.') : 'Pronto para os stories.';
  await desenharStory($('#storyCanvas'), st.pedal, { modelo: st.modelo, foto: st.foto, nome: NOME_APP });
}
async function enviarStory() {
  const st = S.story;
  if (!st) return;
  const canvas = $('#storyCanvas');
  const nome = `pedal-${F.chaveDia(st.pedal.inicio)}.png`;
  if (NATIVO) {
    try {
      const { uri } = await chamar('Filesystem', 'writeFile', { path: nome, data: pngBase64(canvas), directory: 'CACHE' });
      await chamar('Share', 'share', { title: 'Meu pedal', files: [uri], dialogTitle: 'Compartilhar nos stories' });
    } catch (e) { if (!/cancel/i.test(String(e && e.message))) aviso('Não consegui compartilhar a imagem. Tente de novo.'); }
    return;
  }
  const blob = await new Promise(ok => canvas.toBlob(ok, 'image/png'));
  const arquivo = new File([blob], nome, { type: 'image/png' });
  try {
    if (navigator.canShare && navigator.canShare({ files: [arquivo] })) { await navigator.share({ files: [arquivo], title: 'Meu pedal' }); return; }
  } catch (e) { if (e && e.name === 'AbortError') return; }
  const url = URL.createObjectURL(blob);
  const a = h('a', { href: url, download: nome });
  document.body.append(a); a.click(); a.remove();
  setTimeout(() => URL.revokeObjectURL(url), 10000);
  aviso('Imagem salva em Downloads.');
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
  const texto = F.resumoTexto(p, tituloPedal(p), NOME_APP);
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
  const ok = await confirmar('Excluir este pedal?', `${tituloPedal(p)}, ${F.km2(p.distancia)} km, ${F.rotuloDia(p.inicio)}. Ele sai do histórico, do progresso e das rotas.`);
  if (!ok) return;
  await A.apagarPedal(p.id);
  S.pedais = S.pedais.filter(x => x.id !== p.id);
  atualizarRotas();
  history.back();
  aviso('Pedal excluído.', 'Desfazer', async () => { await A.salvarPedal(p); S.pedais.push(p); atualizarRotas(); render(); });
}

// ---------- pedal de 24/10 ----------
// Pedal de 24/10/2026 que não ficou gravado inteiro: a distância conhecida é a
// da volta, 3,2 km. O app pergunta uma vez o que lançar no histórico, sem
// inventar trajeto nem tempo. Depois de respondido, não aparece mais.
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
  } catch { aviso('Não consegui salvar. Tente de novo em Você, Atividades.'); }
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
  $$('[data-ajustes]').forEach(b => b.addEventListener('click', () => { mostrarTela('ajustes'); history.pushState({ ajustes: true }, ''); }));
  $('#btnFecharAjustes').addEventListener('click', () => history.back());
  $$('[data-ir="voce-atividades"]').forEach(b => b.addEventListener('click', () => { S.sub = 'atividades'; mostrarTela('voce'); }));
  $('#btnGps').addEventListener('click', () => {
    const q = qualidade();
    if (NATIVO && q === 'negado') { gps.abrirAjustes('app'); return; }
    if (NATIVO && q === 'indisponivel') { gps.abrirAjustes('localizacao'); return; }
    S.gps.estado = 'procurando'; gps.parar(); ligarGPS(false);
  });
  $('#btnComecar').addEventListener('click', () => comecar(false));
  $('#btnEscolherRota').addEventListener('click', escolherRota);

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
  $('#tMapa').addEventListener('click', () => {
    S.modoMapaAoVivo = !S.modoMapaAoVivo;
    $('#tMapa').setAttribute('aria-pressed', String(S.modoMapaAoVivo));
    $('.painel-pedal').hidden = S.modoMapaAoVivo;
    $('#painelMapaAoVivo').hidden = !S.modoMapaAoVivo;
    if (S.modoMapaAoVivo) renderMapaAoVivo(true);
    else renderPainel();
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
  segurarPara($('#btnFinalizar'), 1500, () => { if (S.cfg.vibrar) vibrar('toque'); finalizar(); }, 'Segure o botão escuro por 1,5 segundo para finalizar.');

  // Você
  $$('.abas-topo button').forEach(b => b.addEventListener('click', () => { S.sub = b.dataset.sub; renderVoce(); }));
  $$('#chipsMetrica button').forEach(b => b.addEventListener('click', () => { S.metrica = b.dataset.metrica; renderProgresso(); }));
  $$('#chipsPeriodo button').forEach(b => b.addEventListener('click', () => { S.periodo = b.dataset.periodo; renderProgresso(); }));
  $('#btnComparar').addEventListener('click', () => { S.comparar = !S.comparar; renderProgresso(); });
  $('#btnMetas').addEventListener('click', abrirMetas);
  $('#formMetas').addEventListener('submit', salvarMetas);

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
  $('#cfgMapa').addEventListener('change', e => { S.cfg.mapa = e.target.checked; S.mapaVivo = null; salvarCfg(); });
  $('#cfgVoz').addEventListener('change', e => { S.cfg.voz = e.target.checked; salvarCfg(); });
  $('#cfgVibra').addEventListener('change', e => { S.cfg.vibrar = e.target.checked; salvarCfg(); if (S.cfg.vibrar) vibrar('km'); });
  $('#cfgAvisoKm').addEventListener('change', e => { S.cfg.avisoKm = Number(e.target.value); salvarCfg(); });
  $('#cfgVozPausa').addEventListener('change', e => { S.cfg.vozPausa = e.target.checked; salvarCfg(); });
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
    const dados = { app: 'hodometro', versao: 2, exportadoEm: new Date().toISOString(), ajustes: S.cfg, pedais: S.pedais, rotas: S.rotas };
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
      const rotas = Array.isArray(dados.rotas) ? dados.rotas.filter(r => r && r.id && !S.rotas.some(x => x.id === r.id)) : [];
      atualizarRotas([...S.rotas, ...rotas]);
      salvarRotas();
      render();
      aviso(`${plural(validos.length, 'pedal importado', 'pedais importados')}.`);
    } catch {
      aviso('Não consegui ler esse arquivo. Escolha um backup exportado pelo app.');
    }
  });
  $('#arqGpx').addEventListener('change', async e => {
    const files = Array.from(e.target.files || []);
    e.target.value = '';
    if (!files.length) return;
    let importados = 0;
    for (const arq of files) {
      try {
        const texto = await arq.text();
        const pedal = converterGPXEmPedal(texto);
        await A.salvarPedal(pedal);
        S.pedais.push(pedal);
        importados++;
      } catch (err) {
        console.warn('Erro ao importar GPX:', arq.name, err);
      }
    }
    if (importados > 0) {
      atualizarRotas();
      aviso(`${importados} ${plural(importados, 'pedal importado', 'pedais importados')} do Strava!`);
      render();
    } else {
      aviso('Não foi possível importar os pedais desse arquivo GPX.');
    }
  });
  $('#btnApagarTudo').addEventListener('click', async () => {
    if (!S.pedais.length) { aviso('Não há pedais para apagar.'); return; }
    const ok = await confirmar('Apagar todos os pedais?', `${plural(S.pedais.length, 'pedal sai', 'pedais saem')} deste celular, junto com as rotas. Exporte um backup antes se quiser guardar.`, 'Apagar tudo');
    if (!ok) return;
    await A.apagarTodos();
    S.pedais = [];
    S.rotas = [];
    S.tentativas = {};
    salvarRotas();
    render();
    aviso('Todos os pedais foram apagados.');
  });

  // Atividade
  $('#btnVoltar').addEventListener('click', () => history.back());
  $('#btnRenomear').addEventListener('click', renomearPedal);
  $('#btnStory').addEventListener('click', () => S.detalhe && abrirStory(S.detalhe));
  $('#btnStoryTopo').addEventListener('click', () => S.detalhe && abrirStory(S.detalhe));
  $('#btnGpx').addEventListener('click', () => S.detalhe && exportarGPX(S.detalhe));
  $('#btnCompartilhar').addEventListener('click', () => S.detalhe && compartilharResumo(S.detalhe));
  $('#btnSalvarRota').addEventListener('click', salvarComoRota);
  $('#btnApagar').addEventListener('click', () => S.detalhe && excluirPedal(S.detalhe));

  // Rota
  $('#btnVoltarRota').addEventListener('click', () => history.back());
  $('#btnRenomearRota').addEventListener('click', renomearRota);
  $('#btnApagarRota').addEventListener('click', excluirRota);
  $('#btnPedalarRota').addEventListener('click', () => {
    const r = S.rotaAberta;
    if (!r) return;
    S.rotaEscolhida = r.id;
    // Fecha o que está por cima e vai para o Gravar
    S.depoisDeFechar = () => { mostrarTela('gravar'); aviso(`Rota escolhida: ${nomeRota(r)}. Toque em Iniciar quando estiver pronto.`); };
    history.go(-S.pilha.length);
  });

  // Stories
  $('#btnFecharStory').addEventListener('click', () => history.back());
  $$('#story [data-modelo]').forEach(b => b.addEventListener('click', () => { if (S.story) { S.story.modelo = b.dataset.modelo; renderStory(); } }));
  $('#arqFoto').addEventListener('change', async e => {
    const arq = e.target.files && e.target.files[0];
    e.target.value = '';
    if (!arq || !S.story) return;
    try {
      const img = new Image();
      img.src = URL.createObjectURL(arq);
      await img.decode();
      S.story.foto = img;
      renderStory();
    } catch { aviso('Não consegui abrir essa foto. Tente outra.'); }
  });
  $('#btnEnviarStory').addEventListener('click', enviarStory);

  // Voltar (do Android ou do app): fecha as telas por cima até o nível da entrada do histórico
  window.addEventListener('popstate', e => {
    const st = e.state || {};
    const nivel = st.nivel || 0;
    while (S.pilha.length > nivel) fecharSobreposta();
    if (!S.pilha.length && S.tela === 'ajustes' && !st.ajustes) mostrarTela(S.telaAntes === 'ajustes' ? 'inicio' : S.telaAntes);
    const depois = S.depoisDeVoltar || (!S.pilha.length && S.depoisDeFechar);
    if (depois) { S.depoisDeVoltar = null; if (!S.pilha.length) S.depoisDeFechar = null; depois(); }
  });
  window.addEventListener('resize', () => {
    if (S.detalhe && temTrajeto(S.detalhe)) desenharMapaPedal($('#dMapa'), S.detalhe.pontos, (S.detalhe.lacunas || []).map(l => l.i));
  });

  // GPS: o cartão mostra "Buscando" se a última leitura ficou velha
  setInterval(() => { if (!S.r && S.tela === 'gravar' && !document.hidden) renderGps(); }, 2000);

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
  $$('[data-nome-app]').forEach(el => { el.textContent = NOME_APP; });
  ligarEventos();
  try { S.pedais = await A.listarPedais(); } catch { S.pedais = []; }
  await carregarRotas();
  let recuperou = false, guiaSalva = null;
  try {
    const ativo = await A.lerEstado('ativo');
    if (ativo && ativo.r) {
      S.r = Rastreador.deJSON(ativo.r);
      S.fonte = gps;
      S.demo = false;
      guiaSalva = ativo.guia || null;
      recuperou = true;
    }
  } catch { /* começa limpo */ }
  if (recuperou) {
    if (guiaSalva) {
      S.guia = criarGuia(guiaSalva.id);
      if (S.guia) Object.assign(S.guia, { feito: guiaSalva.feito || 0, i: guiaSalva.i || 0, fora: !!guiaSalva.fora, concluida: !!guiaSalva.concluida });
    }
    // O pedal continuava gravando: liga de novo o GPS e puxa o que o Android gravou sozinho.
    // As leituras novas esperam na fila até as antigas entrarem.
    ligarGPS(true, false);
    const n = await recuperarPerdidas();
    iniciarRelogio();
    aplicarTela();
    aviso(n > 0
      ? `Pedal em andamento recuperado, com ${n} leituras que o Android gravou com o app fechado.`
      : NATIVO ? 'Pedal em andamento recuperado. Pode seguir.' : 'Pedal em andamento recuperado. O trecho com o app fechado entra em linha reta.', null, null, 7000);
    mostrarTela('gravar');
  } else mostrarTela('inicio');
  registrarSW();
  if (!S.r) setTimeout(oferecerLancamento, 600);
}

iniciar();
