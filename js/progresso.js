// Progresso ao longo do tempo e metas. Sem DOM, testado em tests/progresso.test.js.
//
// Progresso: soma uma métrica (distância, tempo em movimento ou subida) por semana
// (ou por mês, no período de 1 ano) e compara com o período anterior do mesmo
// tamanho, como "618,9 km nos últimos 3 meses, 12% a mais que nos 3 meses antes".
//
// Metas: semana, mês e ano, em km, horas ou metros de subida. Diz quanto falta,
// quanto precisa por semana para chegar e onde termina no ritmo de agora.
import { inicioSemana, addDias } from './formato.js';

export const PERIODOS = Object.freeze({
  mes: { semanas: 4, rotulo: '4 semanas', anterior: 'às 4 semanas anteriores' },
  tri: { semanas: 12, rotulo: '3 meses', anterior: 'aos 3 meses anteriores' },
  ano: { meses: 12, rotulo: '12 meses', anterior: 'aos 12 meses anteriores' },
});

/** Valor de um pedal na métrica: metros, segundos ou metros de subida. */
export function valorPedal(p, metrica) {
  if (metrica === 'tempo') return p.tempoMov || 0;
  if (metrica === 'subida') return p.subida || 0;
  return p.distancia || 0;
}

/** Faixas de tempo do período atual e do anterior, cada uma com {ini, fim} em ms. */
function faixas(periodo, agora) {
  const cfg = PERIODOS[periodo] || PERIODOS.tri;
  if (cfg.meses) {
    const d = new Date(agora);
    return Array.from({ length: cfg.meses * 2 }, (_, i) => {
      const ini = new Date(d.getFullYear(), d.getMonth() - cfg.meses * 2 + 1 + i, 1);
      const fim = new Date(ini.getFullYear(), ini.getMonth() + 1, 1);
      return { ini: ini.getTime(), fim: fim.getTime() };
    });
  }
  const seg = inicioSemana(agora);
  return Array.from({ length: cfg.semanas * 2 }, (_, i) => {
    const ini = addDias(seg, (i - cfg.semanas * 2 + 1) * 7);
    return { ini: ini.getTime(), fim: addDias(ini, 7).getTime() };
  });
}

/**
 * Série do período atual (até hoje) e do anterior, alinhadas faixa a faixa.
 * variacao: fração (0,12 = 12% a mais) ou null se o período anterior está vazio.
 */
export function progresso(pedais, metrica = 'distancia', periodo = 'tri', agora = Date.now()) {
  const fx = faixas(periodo, agora).map(f => ({ ...f, valor: 0, n: 0 }));
  for (const p of pedais) {
    if (p.demo) continue;
    const f = fx.find(x => p.inicio >= x.ini && p.inicio < x.fim);
    if (f) { f.valor += valorPedal(p, metrica); f.n++; }
  }
  const meio = fx.length / 2;
  const anterior = fx.slice(0, meio), atual = fx.slice(meio);
  const soma = a => a.reduce((s, f) => s + f.valor, 0);
  const total = soma(atual), totalAnterior = soma(anterior);
  return {
    metrica, periodo, atual, anterior, total, totalAnterior,
    pedais: atual.reduce((s, f) => s + f.n, 0),
    variacao: totalAnterior > 0 ? (total - totalAnterior) / totalAnterior : null,
    ini: atual[0].ini, iniAnterior: anterior[0].ini,
  };
}

const NOMES = {
  distancia: ['Sua distância total', 'f'],
  tempo: ['Seu tempo pedalando', 'm'],
  subida: ['Sua subida acumulada', 'f'],
};

/** Frase do resumo: "Sua distância total aumentou 12% em relação aos 3 meses anteriores." */
export function resumoProgresso(pg) {
  const [nome] = NOMES[pg.metrica] || NOMES.distancia;
  const rel = (PERIODOS[pg.periodo] || PERIODOS.tri).anterior;
  if (pg.variacao == null) {
    return pg.total > 0
      ? `Primeiro período com pedais. A comparação aparece quando houver pedais no período anterior.`
      : 'Nenhum pedal neste período ainda.';
  }
  const pct = Math.round(Math.abs(pg.variacao) * 100);
  if (pct === 0) return `${nome} ficou igual em relação ${rel}.`;
  return `${nome} ${pg.variacao > 0 ? 'aumentou' : 'diminuiu'} ${pct}% em relação ${rel}.`;
}

// ---------- metas ----------

/** Início e fim (ms) da semana, do mês ou do ano de `agora`. */
export function janelaMeta(periodo, agora = Date.now()) {
  const d = new Date(agora);
  if (periodo === 'ano') return { ini: new Date(d.getFullYear(), 0, 1).getTime(), fim: new Date(d.getFullYear() + 1, 0, 1).getTime() };
  if (periodo === 'mes') return { ini: new Date(d.getFullYear(), d.getMonth(), 1).getTime(), fim: new Date(d.getFullYear(), d.getMonth() + 1, 1).getTime() };
  const ini = inicioSemana(agora);
  return { ini: ini.getTime(), fim: addDias(ini, 7).getTime() };
}

/** Alvo da meta na unidade do motor: km viram metros, horas viram segundos. */
export const alvoMeta = meta => (meta.tipo === 'tempo' ? meta.alvo * 3600 : meta.tipo === 'subida' ? meta.alvo : meta.alvo * 1000);

/**
 * meta: {tipo: 'distancia' | 'tempo' | 'subida', alvo: km, horas ou metros}.
 * Devolve feito, falta, fração, quanto precisa por semana e a projeção no ritmo de agora.
 */
export function avaliarMeta(pedais, periodo, meta, agora = Date.now()) {
  const { ini, fim } = janelaMeta(periodo, agora);
  let feito = 0, n = 0;
  for (const p of pedais) {
    if (p.demo || p.inicio < ini || p.inicio >= fim) continue;
    feito += valorPedal(p, meta.tipo);
    n++;
  }
  const alvo = alvoMeta(meta);
  const falta = Math.max(0, alvo - feito);
  const diaMs = 864e5;
  const diasRestantes = Math.max(1, Math.ceil((fim - agora) / diaMs));
  const decorrido = Math.max(diaMs, agora - ini);
  return {
    periodo, tipo: meta.tipo, feito, alvo, falta, n,
    fracao: alvo > 0 ? Math.min(1, feito / alvo) : 0,
    batida: alvo > 0 && feito >= alvo,
    diasRestantes,
    porSemana: falta > 0 && periodo !== 'semana' ? falta / Math.max(1, diasRestantes / 7) : null,
    projecao: feito > 0 ? feito / decorrido * (fim - ini) : 0,
  };
}
