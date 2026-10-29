// Testes do rendimento desde o começo.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { rendimento, destaques, reta, MARCOS } from '../js/rendimento.js';

const dia = (m, d, h = 8) => new Date(2026, m, d, h).getTime();
const agora = dia(9, 28, 20);   // quarta, 28/10
const p = (id, inicio, km, min, extra = {}) => ({ id, via: 'gps', inicio, fim: inicio + min * 60000, distancia: km * 1000, tempoMov: min * 60, tempoTotal: min * 60, subida: 10, ...extra });

test('reta de mínimos quadrados', () => {
  assert.equal(reta([5]), null);
  const r = reta([1, 2, 3, 4]);
  assert.ok(Math.abs(r.a - 1) < 1e-9 && Math.abs(r.b - 1) < 1e-9);
  assert.equal(reta([3, 3, 3]).b, 0);
});

test('sem pedais fica vazio; demonstração e pedal de amigo não contam', () => {
  assert.equal(rendimento([], { agora }).vazio, true);
  assert.equal(rendimento([p('d', dia(9, 20), 6, 20, { demo: true }), p('x', dia(9, 21), 6, 20, { amigo: { id: 'u1' } })], { agora }).vazio, true);
});

test('quem começou há pouco: janela do primeiro pedal até hoje', () => {
  const pedais = [
    p('a', dia(9, 12), 3.2, 16),      // 12 km/h
    p('b', dia(9, 14), 4, 18),
    p('c', dia(9, 19), 6, 25),
    p('d', dia(9, 24), 3.2, 12),      // 16 km/h
    p('e', dia(9, 27), 8, 30),        // 16 km/h
    { id: 'm', via: 'manual', inicio: dia(9, 25, 12), distancia: 2000, tempoMov: 0, tempoTotal: 0 },
  ];
  const rd = rendimento(pedais, { agora });
  assert.equal(rd.vazio, false);
  assert.equal(rd.n, 6);
  assert.equal(rd.dias, 17, 'de 12/10 a 28/10');
  assert.equal(rd.total.distancia, 26400);
  assert.equal(rd.semanas.length, 3, 'semanas de 12/10, 19/10 e 26/10');
  assert.deepEqual(rd.semanas.map(w => w.n), [2, 3, 1]);
  assert.equal(rd.melhorSemana.ini, rd.semanas[1].ini);
  assert.equal(rd.semanasSeguidas, 3);
  assert.equal(rd.maiorSequenciaSemanas, 3);
  assert.equal(rd.diasAtivos, 6);
  // Acumulado começa em zero e termina hoje com o total
  assert.equal(rd.acumulado[0].v, 0);
  assert.equal(rd.acumulado[rd.acumulado.length - 1].v, 26400);
  assert.ok(rd.acumulado.every((x, i) => !i || x.v >= rd.acumulado[i - 1].v), 'só sobe');
  // Velocidade: só pedais com GPS (o manual sem tempo fica de fora)
  assert.equal(rd.evolucao.length, 5);
  assert.ok(rd.tendencia.para > rd.tendencia.de, 'média subindo');
  assert.equal(rd.velocidade.k, 1);
  assert.ok(Math.abs(rd.velocidade.de - 3200 / 960) < 1e-9);
  assert.ok(Math.abs(rd.velocidade.para - 8000 / 1800) < 1e-9);
  assert.ok(rd.velocidade.variacao > 0.3);
  // Marco: 26,4 km → próximo é 50 km
  assert.equal(rd.marco.alvo, 50);
  assert.equal(rd.marco.anterior, 25);
  assert.equal(rd.marco.falta, 23600);
  assert.equal(rd.marco.dias, Math.ceil(23600 / (26400 / 17)));
  const frases = destaques(rd, { kmh: v => (v * 3.6).toFixed(1), km1: m => (m / 1000).toFixed(1), duracao: s => `${s}s`, nomeRota: r => r.nome });
  assert.match(frases[0].texto, /^Sua média subiu \d+%: de 12\.0 para 16\.0 km\/h, comparando o primeiro com o último pedal\.$/);
  assert.equal(frases[0].tipo, 'sobe');
  assert.ok(frases.some(f => /3 semanas seguidas/.test(f.texto)));
});

test('semana atual sem pedal não quebra a sequência; semana vazia no meio quebra', () => {
  const rd = rendimento([p('a', dia(9, 5), 5, 20), p('b', dia(9, 19), 5, 20), p('c', dia(9, 20), 5, 20)], { agora });
  assert.deepEqual(rd.semanas.map(w => w.n), [1, 0, 2, 0]);
  assert.equal(rd.semanasSeguidas, 1, 'a semana de 19/10, com a atual ainda em aberto');
  assert.equal(rd.maiorSequenciaDias, 2, '19 e 20/10');
  assert.equal(rd.maiorSequenciaSemanas, 1);
});

test('rota: primeiro tempo contra o melhor', () => {
  const pedais = [p('a', dia(9, 12), 3.2, 16), p('b', dia(9, 14), 3.2, 14), p('c', dia(9, 16), 3.2, 15)];
  const rotas = [{ id: 'r1', nome: 'Ida', linha: [[0, 0], [0, 1], [0, 2]] }, { id: 'r2', oculta: true, linha: [[0, 0], [0, 1], [0, 2]] }];
  const rd = rendimento(pedais, { rotas, tentativas: { r1: ['a', 'b', 'c'], r2: ['a', 'b'] }, agora });
  assert.equal(rd.melhorasRota.length, 1, 'rota oculta fica de fora');
  assert.equal(rd.melhorasRota[0].primeiro, 960);
  assert.equal(rd.melhorasRota[0].melhor, 840);
  assert.equal(rd.melhorasRota[0].ganho, 120);
});

test('marcos em ordem e depois do último', () => {
  assert.ok(MARCOS.every((m, i) => !i || m > MARCOS[i - 1]));
  const rd = rendimento([p('a', dia(9, 1), 12000, 60000)], { agora });
  assert.equal(rd.marco.alvo, 15000);
});
