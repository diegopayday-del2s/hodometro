// Formatação em português e contas sobre o histórico. Sem DOM.

const nf1 = new Intl.NumberFormat('pt-BR', { minimumFractionDigits: 1, maximumFractionDigits: 1 });
const nf2 = new Intl.NumberFormat('pt-BR', { minimumFractionDigits: 2, maximumFractionDigits: 2 });
const nf0 = new Intl.NumberFormat('pt-BR', { maximumFractionDigits: 0 });
const pad = n => String(n).padStart(2, '0');

export const DIAS = ['dom', 'seg', 'ter', 'qua', 'qui', 'sex', 'sáb'];
export const MESES = ['janeiro', 'fevereiro', 'março', 'abril', 'maio', 'junho', 'julho', 'agosto', 'setembro', 'outubro', 'novembro', 'dezembro'];

/** Metros em km com 2 casas, sem arredondar para cima (como um ciclocomputador). */
export const kmAoVivo = m => nf2.format(Math.floor(Math.max(0, m) / 10) / 100);
/** Metros em km com 1 casa. */
export const km1 = m => nf1.format(Math.round(Math.max(0, m) / 100) / 10);
/** Metros em km com 2 casas. */
export const km2 = m => nf2.format(Math.round(Math.max(0, m) / 10) / 100);
/** m/s em km/h com 1 casa. */
export const kmh = ms => nf1.format(Math.max(0, ms || 0) * 3.6);
export const inteiro = n => nf0.format(Math.round(n || 0));

/** Segundos em 1:02:03 ou 12:03. */
export function duracao(s) {
  s = Math.max(0, Math.round(s || 0));
  const h = Math.floor(s / 3600), m = Math.floor(s / 60) % 60, ss = s % 60;
  return h ? `${h}:${pad(m)}:${pad(ss)}` : `${pad(m)}:${pad(ss)}`;
}

/** Segundos em horas e minutos: 0:45, 12:05. */
export function horasMin(s) {
  const m = Math.floor(Math.max(0, s || 0) / 60);
  return `${Math.floor(m / 60)}:${pad(m % 60)}`;
}

/** Segundos em "1 h 05 min" ou "12 min" (para resumos). */
export function duracaoCurta(s) {
  s = Math.max(0, Math.round(s || 0));
  const h = Math.floor(s / 3600), m = Math.floor(s / 60) % 60;
  if (h) return `${h} h ${pad(m)} min`;
  if (m) return `${m} min`;
  return `${s} s`;
}

/** Segundos por km em 3:24 (ritmo). */
export function ritmo(sPorKm) {
  if (!Number.isFinite(sPorKm) || sPorKm <= 0) return '--';
  if (sPorKm >= 3600) return '59:59';
  const s = Math.round(sPorKm);
  return `${Math.floor(s / 60)}:${pad(s % 60)}`;
}

/** Duração falada: "3 minutos e 12 segundos". */
export function duracaoFalada(s) {
  s = Math.max(0, Math.round(s || 0));
  const h = Math.floor(s / 3600), m = Math.floor(s / 60) % 60, ss = s % 60;
  const p = [];
  if (h) p.push(h === 1 ? '1 hora' : `${h} horas`);
  if (m) p.push(m === 1 ? '1 minuto' : `${m} minutos`);
  if (ss || !p.length) p.push(ss === 1 ? '1 segundo' : `${ss} segundos`);
  return p.length > 1 ? p.slice(0, -1).join(', ') + ' e ' + p[p.length - 1] : p[0];
}

/** Texto do aviso por voz a cada km. */
export function falaKm(kmFeitos, tempoKm, mediaMs) {
  const nome = kmFeitos === 1 ? '1 quilômetro' : `${kmFeitos} quilômetros`;
  return `${nome}. Último quilômetro em ${duracaoFalada(tempoKm)}. Média de ${kmh(mediaMs)} quilômetros por hora.`;
}

export const hora = t => { const d = new Date(t); return `${pad(d.getHours())}:${pad(d.getMinutes())}`; };
export const diaMes = d => `${pad(d.getDate())}/${pad(d.getMonth() + 1)}`;
export const chaveDia = t => { const d = new Date(t); return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`; };
export const deChaveDia = s => { const [y, m, d] = s.split('-').map(Number); return new Date(y, m - 1, d); };
export const inicioDoDia = t => { const d = new Date(t); return new Date(d.getFullYear(), d.getMonth(), d.getDate()).getTime(); };
export const addDias = (d, n) => new Date(d.getFullYear(), d.getMonth(), d.getDate() + n);
export const inicioSemana = t => { const d = new Date(t); const x = new Date(d.getFullYear(), d.getMonth(), d.getDate()); return addDias(x, -((x.getDay() + 6) % 7)); };

/** "Hoje", "Ontem" ou "qua, 21/10". */
export function rotuloDia(t, agora = Date.now()) {
  const d = new Date(t);
  const hoje = inicioDoDia(agora);
  const dia = inicioDoDia(t);
  if (dia === hoje) return 'Hoje';
  if (dia === addDias(new Date(hoje), -1).getTime()) return 'Ontem';
  const ano = d.getFullYear() !== new Date(agora).getFullYear() ? `/${String(d.getFullYear()).slice(2)}` : '';
  return `${DIAS[d.getDay()]}, ${diaMes(d)}${ano}`;
}

export function dataLonga(t) {
  return new Date(t).toLocaleDateString('pt-BR', { weekday: 'long', day: 'numeric', month: 'long', year: 'numeric' });
}

// ---------- histórico ----------

/** Filtra pedais do período: 'semana', 'mes', 'ano' ou 'total'. */
export function doPeriodo(pedais, periodo, agora = Date.now()) {
  const d = new Date(agora);
  let ini = -Infinity, fim = Infinity;
  if (periodo === 'semana') { ini = inicioSemana(agora).getTime(); fim = addDias(new Date(ini), 7).getTime(); }
  else if (periodo === 'mes') { ini = new Date(d.getFullYear(), d.getMonth(), 1).getTime(); fim = new Date(d.getFullYear(), d.getMonth() + 1, 1).getTime(); }
  else if (periodo === 'ano') { ini = new Date(d.getFullYear(), 0, 1).getTime(); fim = new Date(d.getFullYear() + 1, 0, 1).getTime(); }
  return pedais.filter(p => p.inicio >= ini && p.inicio < fim);
}

export function somar(pedais) {
  const t = { n: pedais.length, distancia: 0, tempoMov: 0, subida: 0 };
  for (const p of pedais) { t.distancia += p.distancia || 0; t.tempoMov += p.tempoMov || 0; t.subida += p.subida || 0; }
  t.velMedia = t.tempoMov > 0 ? t.distancia / t.tempoMov : 0;
  return t;
}

/** Km por dia da semana atual (seg a dom). */
export function semana(pedais, agora = Date.now()) {
  const ini = inicioSemana(agora);
  return Array.from({ length: 7 }, (_, i) => {
    const d = addDias(ini, i);
    const chave = chaveDia(d.getTime());
    const doDia = pedais.filter(p => chaveDia(p.inicio) === chave);
    return { data: d, chave, distancia: doDia.reduce((a, p) => a + (p.distancia || 0), 0), n: doDia.length };
  });
}

/** Melhores marcas, só com pedais gravados pelo GPS (e sem demonstração). */
export function recordes(pedais) {
  const gps = pedais.filter(p => p.via === 'gps' && !p.demo);
  const r = { maiorDistancia: null, maiorMedia: null, melhorKm: null, maiorSubida: null, maiorVel: null };
  for (const p of gps) {
    if (!r.maiorDistancia || p.distancia > r.maiorDistancia.valor) r.maiorDistancia = { valor: p.distancia, id: p.id, inicio: p.inicio };
    if (p.distancia >= 5000 && p.tempoMov > 0) {
      const m = p.distancia / p.tempoMov;
      if (!r.maiorMedia || m > r.maiorMedia.valor) r.maiorMedia = { valor: m, id: p.id, inicio: p.inicio };
    }
    for (const k of p.parciais || []) {
      if (k.tempo > 0 && (!r.melhorKm || k.tempo < r.melhorKm.valor)) r.melhorKm = { valor: k.tempo, id: p.id, inicio: p.inicio, km: k.km };
    }
    if (p.subida > 0 && (!r.maiorSubida || p.subida > r.maiorSubida.valor)) r.maiorSubida = { valor: p.subida, id: p.id, inicio: p.inicio };
    if (p.velMax > 0 && (!r.maiorVel || p.velMax > r.maiorVel.valor)) r.maiorVel = { valor: p.velMax, id: p.id, inicio: p.inicio };
  }
  return r;
}

/** Agrupa por mês, do mais novo para o mais antigo. */
export function porMes(pedais) {
  const grupos = new Map();
  for (const p of pedais.slice().sort((a, b) => b.inicio - a.inicio)) {
    const d = new Date(p.inicio);
    const chave = `${d.getFullYear()}-${pad(d.getMonth() + 1)}`;
    if (!grupos.has(chave)) grupos.set(chave, { chave, rotulo: `${MESES[d.getMonth()]} de ${d.getFullYear()}`, pedais: [] });
    grupos.get(chave).pedais.push(p);
  }
  return [...grupos.values()];
}
