// Rendimento desde o começo: como você está evoluindo, só com os seus pedais.
// Sem DOM, testado em tests/rendimento.test.js.
//
// Entra todo pedal seu que não é demonstração nem de amigo. Para velocidade,
// só pedais com GPS de pelo menos 1 km e 1 min: pedal curto demais distorce a
// média. A janela é sempre do primeiro pedal até hoje, para o gráfico não ficar
// vazio de quem começou há pouco.
import { inicioSemana, addDias, inicioDoDia, somar } from './formato.js';
import { estatisticasRota } from './rotas.js';

const DIA = 864e5;
/** Marcos de distância total, em km. */
export const MARCOS = [10, 25, 50, 100, 150, 200, 300, 500, 750, 1000, 1500, 2000, 3000, 5000, 7500, 10000];

export const seus = pedais => (pedais || []).filter(p => p && !p.demo && !p.amigo);
export const contaVelocidade = p => p.via === 'gps' && p.tempoMov >= 60 && p.distancia >= 1000;

/** Reta de mínimos quadrados y = a + b·i (i = 0, 1, 2...). null com menos de 2 valores. */
export function reta(ys) {
  const n = ys.length;
  if (n < 2) return null;
  const mx = (n - 1) / 2;
  const my = ys.reduce((s, y) => s + y, 0) / n;
  let num = 0, den = 0;
  ys.forEach((y, x) => { num += (x - mx) * (y - my); den += (x - mx) ** 2; });
  const b = den > 0 ? num / den : 0;
  return { a: my - b * mx, b };
}

const variacao = (de, para) => (de > 0 ? (para - de) / de : null);
/** Velocidade média de um grupo: distância somada sobre tempo somado. */
const velGrupo = l => { const t = l.reduce((s, p) => s + p.tempoMov, 0); return t > 0 ? l.reduce((s, p) => s + p.distancia, 0) / t : 0; };
/** Quantos pedais em cada ponta para comparar começo e agora: um terço, de 1 a 5. */
const ponta = n => Math.min(5, Math.max(1, Math.floor(n / 3)));

/** Maior sequência de itens seguidos (chaves numéricas que andam de `passo` em `passo`). */
function maiorSequencia(chaves, passo) {
  const l = [...new Set(chaves)].sort((a, b) => a - b);
  let maior = 0, atual = 0, ant = null;
  for (const k of l) {
    atual = ant != null && Math.round((k - ant) / passo) === 1 ? atual + 1 : 1;
    maior = Math.max(maior, atual);
    ant = k;
  }
  return maior;
}

/**
 * Tudo da aba Rendimento. `rotas` e `tentativas` vêm de organizarRotas.
 * Distâncias em metros, tempos em segundos, velocidades em m/s.
 */
export function rendimento(pedais, { rotas = [], tentativas = {}, agora = Date.now() } = {}) {
  const meus = seus(pedais).sort((a, b) => a.inicio - b.inicio);
  if (!meus.length) return { vazio: true, n: 0 };
  const inicio = meus[0].inicio;
  const hoje = inicioDoDia(agora);
  const dias = Math.max(1, Math.round((hoje - inicioDoDia(inicio)) / DIA) + 1);
  const total = somar(meus);
  const diasPedalados = [...new Set(meus.map(p => inicioDoDia(p.inicio)))];

  // Semanas desde a do primeiro pedal até a de hoje
  const semanas = [];
  for (let s = inicioSemana(inicio); s.getTime() <= inicioSemana(agora).getTime(); s = addDias(s, 7)) {
    semanas.push({ ini: s.getTime(), fim: addDias(s, 7).getTime(), distancia: 0, tempoMov: 0, n: 0 });
  }
  for (const p of meus) {
    const w = semanas.find(x => p.inicio >= x.ini && p.inicio < x.fim);
    if (w) { w.distancia += p.distancia || 0; w.tempoMov += p.tempoMov || 0; w.n++; }
  }
  const melhorSemana = semanas.reduce((m, w) => (w.distancia > (m ? m.distancia : 0) ? w : m), null);
  // Semanas seguidas com pedal até agora (a semana atual sem pedal ainda não quebra)
  let semanasSeguidas = 0;
  for (let i = semanas.length - 1; i >= 0; i--) {
    if (semanas[i].n) semanasSeguidas++;
    else if (i < semanas.length - 1) break;
  }

  // Distância somada dia a dia, do primeiro pedal até hoje
  const acumulado = [{ t: inicioDoDia(inicio), v: 0 }];
  let soma = 0;
  for (const d of diasPedalados) {
    soma += meus.filter(p => inicioDoDia(p.inicio) === d).reduce((s, p) => s + (p.distancia || 0), 0);
    acumulado.push({ t: d + DIA - 1, v: soma });
  }
  if (acumulado[acumulado.length - 1].t < hoje) acumulado.push({ t: hoje + DIA - 1, v: soma });

  // Velocidade média pedal a pedal e a tendência
  const comVel = meus.filter(contaVelocidade);
  const evolucao = comVel.map(p => ({ id: p.id, inicio: p.inicio, vel: p.distancia / p.tempoMov, dist: p.distancia }));
  const r = evolucao.length >= 3 ? reta(evolucao.map(e => e.vel)) : null;
  const tendencia = r ? { de: r.a, para: r.a + r.b * (evolucao.length - 1), porPedal: r.b, variacao: variacao(r.a, r.a + r.b * (evolucao.length - 1)) } : null;

  // Começo e agora: os primeiros pedais contra os últimos
  let velocidade = null;
  if (comVel.length >= 2) {
    const k = ponta(comVel.length);
    const de = velGrupo(comVel.slice(0, k)), para = velGrupo(comVel.slice(-k));
    velocidade = { k, de, para, variacao: variacao(de, para) };
  }
  let distancia = null;
  if (meus.length >= 2) {
    const k = ponta(meus.length);
    const media = l => l.reduce((s, p) => s + (p.distancia || 0), 0) / l.length;
    const de = media(meus.slice(0, k)), para = media(meus.slice(-k));
    distancia = { k, de, para, variacao: variacao(de, para) };
  }

  // Próximo marco e quando chega nele no ritmo de agora
  const km = total.distancia / 1000;
  const alvo = MARCOS.find(m => m > km + 1e-9) ?? Math.ceil((km + 1) / 5000) * 5000;
  const porDia = total.distancia / dias;
  const falta = alvo * 1000 - total.distancia;
  const marco = { alvo, falta, anterior: [...MARCOS].reverse().find(m => m <= km) || 0, dias: porDia > 0 ? Math.ceil(falta / porDia) : null };

  // Rotas em que você melhorou: primeiro tempo contra o melhor
  const melhorasRota = [];
  for (const rota of rotas) {
    if (rota.oculta) continue;
    const e = estatisticasRota(tentativas[rota.id] || [], meus);
    const tempos = e.pedais.filter(p => p.tempoMov > 0);
    if (tempos.length < 2) continue;
    const primeiro = tempos[0];
    melhorasRota.push({ rota, vezes: e.vezes, primeiro: primeiro.tempoMov, melhor: e.melhor.tempoMov, ganho: primeiro.tempoMov - e.melhor.tempoMov, ultimo: tempos[tempos.length - 1].tempoMov });
  }
  melhorasRota.sort((a, b) => b.ganho - a.ganho);

  return {
    vazio: false,
    inicio, dias, n: meus.length, diasAtivos: diasPedalados.length,
    total,
    porPedal: total.distancia / meus.length,
    porSemana: total.distancia / semanas.length,
    pedaisPorSemana: meus.length / semanas.length,
    semanas, melhorSemana, semanasSeguidas,
    maiorSequenciaDias: maiorSequencia(diasPedalados.map(d => Math.round(d / DIA)), 1),
    maiorSequenciaSemanas: maiorSequencia(semanas.filter(w => w.n).map(w => Math.round(w.ini / DIA)), 7),
    acumulado,
    evolucao, tendencia, velocidade, distancia,
    marco,
    melhorasRota,
  };
}

/**
 * Frases do que mudou desde o começo, da mais forte para a mais fraca.
 * `f` traz as funções de texto (kmh, km1, duracao) para este arquivo não depender do formato de tela.
 */
export function destaques(rd, f) {
  if (!rd || rd.vazio) return [];
  const pct = v => `${Math.round(Math.abs(v) * 100)}%`;
  const out = [];
  if (rd.velocidade && rd.velocidade.variacao != null && Math.abs(rd.velocidade.variacao) >= 0.02) {
    const v = rd.velocidade;
    out.push({ tipo: v.variacao > 0 ? 'sobe' : 'desce', texto: `Sua média ${v.variacao > 0 ? 'subiu' : 'caiu'} ${pct(v.variacao)}: de ${f.kmh(v.de)} para ${f.kmh(v.para)} km/h, comparando ${v.k === 1 ? 'o primeiro com o último pedal' : `os ${v.k} primeiros com os ${v.k} últimos pedais`}.` });
  }
  if (rd.distancia && rd.distancia.variacao != null && Math.abs(rd.distancia.variacao) >= 0.05) {
    const d = rd.distancia;
    out.push({ tipo: d.variacao > 0 ? 'sobe' : 'desce', texto: `Seus pedais estão ${pct(d.variacao)} ${d.variacao > 0 ? 'mais longos' : 'mais curtos'}: de ${f.km1(d.de)} para ${f.km1(d.para)} km em média.` });
  }
  const m = rd.melhorasRota.find(x => x.ganho >= 5);
  if (m) out.push({ tipo: 'sobe', texto: `Na rota ${f.nomeRota(m.rota)} você já está ${f.duracao(m.ganho)} mais rápido que na primeira vez.` });
  if (rd.semanasSeguidas >= 2) out.push({ tipo: 'neutro', texto: `${rd.semanasSeguidas} semanas seguidas pedalando.` });
  return out;
}
