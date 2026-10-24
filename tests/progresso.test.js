import { test } from 'node:test';
import assert from 'node:assert/strict';
import { progresso, resumoProgresso, avaliarMeta, janelaMeta } from '../js/progresso.js';

const agora = new Date(2026, 9, 24, 18).getTime();   // sábado
const dia = (m, d, h = 8) => new Date(2026, m, d, h).getTime();

test('progresso de 3 meses compara com os 3 meses anteriores', () => {
  const pedais = [
    { inicio: dia(9, 24), distancia: 3200, tempoMov: 720, subida: 10 },
    { inicio: dia(9, 5), distancia: 10000, tempoMov: 2000, subida: 80 },
    { inicio: dia(7, 10), distancia: 5000, tempoMov: 1000, subida: 20 },
    { inicio: dia(5, 1), distancia: 9000, tempoMov: 1800, subida: 40 },   // período anterior
    { inicio: dia(9, 20), distancia: 50000, tempoMov: 9000, demo: true },
  ];
  const pg = progresso(pedais, 'distancia', 'tri', agora);
  assert.equal(pg.atual.length, 12);
  assert.equal(pg.anterior.length, 12);
  assert.equal(pg.total, 18200);
  assert.equal(pg.totalAnterior, 9000);
  assert.ok(Math.abs(pg.variacao - (18200 / 9000 - 1)) < 1e-9);
  assert.equal(pg.atual[11].valor, 3200, 'a semana de hoje é a última');
  assert.equal(pg.pedais, 3);
  assert.equal(resumoProgresso(pg), 'Sua distância total aumentou 102% em relação aos 3 meses anteriores.');
  const t = progresso(pedais, 'tempo', 'mes', agora);
  assert.equal(t.atual.length, 4);
  assert.equal(t.total, 2720);
  assert.equal(resumoProgresso({ ...t, variacao: null }), 'Primeiro período com pedais. A comparação aparece quando houver pedais no período anterior.');
  const ano = progresso(pedais, 'subida', 'ano', agora);
  assert.equal(ano.atual.length, 12);
  assert.equal(ano.total, 150);
  assert.equal(resumoProgresso({ ...ano, variacao: -0.1 }), 'Sua subida acumulada diminuiu 10% em relação aos 12 meses anteriores.');
});

test('metas: falta, por semana e projeção', () => {
  const pedais = [{ inicio: dia(9, 24), distancia: 3200, tempoMov: 720 }, { inicio: dia(0, 10), distancia: 96800, tempoMov: 20000 }];
  const sem = avaliarMeta(pedais, 'semana', { tipo: 'distancia', alvo: 20 }, agora);
  assert.equal(sem.feito, 3200);
  assert.equal(sem.falta, 16800);
  assert.equal(sem.porSemana, null);
  assert.equal(sem.batida, false);
  const ano = avaliarMeta(pedais, 'ano', { tipo: 'distancia', alvo: 1000 }, agora);
  assert.equal(ano.feito, 100000);
  assert.ok(ano.porSemana > 90000 && ano.porSemana < 100000, `por semana ${ano.porSemana}`);
  assert.ok(ano.projecao > 120000 && ano.projecao < 125000, `projeção ${ano.projecao}`);
  const horas = avaliarMeta(pedais, 'semana', { tipo: 'tempo', alvo: 0.1 }, agora);
  assert.equal(horas.batida, true);
  assert.equal(horas.fracao, 1);
  const j = janelaMeta('mes', agora);
  assert.equal(new Date(j.ini).getDate(), 1);
  assert.equal(new Date(j.fim).getMonth(), 10);
});
