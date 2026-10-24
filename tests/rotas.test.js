// Testes das rotas: reconhecer o mesmo caminho e guiar durante o pedal.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { reamostrar, comprimento, assinatura, mesmoCaminho, organizarRotas, estatisticasRota, curvaTempo, GuiaRota, rotaDoPedal } from '../js/rotas.js';
import { gerarPercurso } from '../js/simulador.js';
import { distancia } from '../js/geo.js';

const DIA = 864e5;
const T0 = new Date(2026, 9, 1, 7, 0).getTime();
const IDA = (v = 5) => [{ tipo: 'reta', dist: 1000, vel: v, rumo: 0 }, { tipo: 'curva', raio: 15, graus: 90, vel: 4 }, { tipo: 'reta', dist: 800, vel: v }];
const OUTRA = (v = 5) => [{ tipo: 'reta', dist: 1000, vel: v, rumo: 0 }, { tipo: 'curva', raio: 15, graus: -90, vel: 4 }, { tipo: 'reta', dist: 800, vel: v }];

function pedal(id, trechos, semente, inicio, extra = {}) {
  const g = gerarPercurso(trechos, { semente, t0: inicio });
  const pontos = g.leituras.map(f => [f.lat, f.lon, (f.t - inicio) / 1000, f.alt]);
  return { id, via: 'gps', inicio, distancia: Math.round(g.distReal), tempoMov: Math.round(g.movReal), tempoTotal: Math.round(g.totalReal), subida: 0, pontos, paradas: [], ...extra };
}
const inverter = (p, id) => ({ ...p, id, pontos: p.pontos.slice().reverse().map((q, i) => [q[0], q[1], i, q[3]]) });

test('reamostrar põe um ponto a cada 50 m sem mudar o comprimento', () => {
  // Linha reta de 1 km, com pontos a cada 7 m
  const reta = Array.from({ length: 144 }, (_, i) => [-23.55 + i * 7 / 111195, -46.63]);
  const l = reamostrar(reta);
  const passos = l.slice(1).map((q, i) => distancia(l[i][0], l[i][1], q[0], q[1]));
  assert.ok(passos.slice(0, -1).every(d => Math.abs(d - 50) < 0.2), 'passos de 50 m');
  assert.equal(l.length, 22);
  // Com o tremido do GPS, o comprimento continua o do caminho gravado
  const p = pedal('a', IDA(), 1, T0);
  const real = p.pontos.reduce((s, q, i) => (i ? s + distancia(p.pontos[i - 1][0], p.pontos[i - 1][1], q[0], q[1]) : 0), 0);
  assert.ok(Math.abs(comprimento(reamostrar(p.pontos)) - real) / real < 0.15, 'comprimento parecido');
});

test('mesmo caminho com GPS diferente é a mesma rota; outro caminho e a volta não são', () => {
  const a1 = assinatura(pedal('a1', IDA(), 1, T0));
  const a2 = assinatura(pedal('a2', IDA(4.2), 2, T0 + DIA));
  const b = assinatura(pedal('b', OUTRA(), 3, T0 + 2 * DIA));
  const volta = assinatura(inverter(pedal('v', IDA(), 4, T0), 'v'));
  assert.equal(mesmoCaminho(a1, a2), true);
  assert.equal(mesmoCaminho(a1, b), false, 'virou para o outro lado');
  assert.equal(mesmoCaminho(a1, volta), false, 'volta é outra rota');
});

test('pedais repetidos viram rota automática e o pedal avulso não', () => {
  const pedais = [
    pedal('a1', IDA(), 1, T0), pedal('a2', IDA(4.5), 2, T0 + DIA), pedal('a3', IDA(5.5), 3, T0 + 2 * DIA),
    pedal('b1', OUTRA(), 4, T0 + 3 * DIA), pedal('b2', OUTRA(), 5, T0 + 4 * DIA),
    pedal('c1', [{ tipo: 'reta', dist: 3000, vel: 6, rumo: 200 }], 6, T0 + 5 * DIA),
    { id: 'm', via: 'manual', inicio: T0, distancia: 3200, tempoMov: 0, pontos: [] },
  ];
  const { rotas, tentativas, mudou } = organizarRotas([], pedais);
  assert.equal(mudou, true);
  assert.equal(rotas.length, 2);
  const ra = rotas.find(r => r.refId === 'a1'), rb = rotas.find(r => r.refId === 'b1');
  assert.deepEqual(tentativas[ra.id], ['a1', 'a2', 'a3']);
  assert.deepEqual(tentativas[rb.id], ['b1', 'b2']);
  // Com o nome salvo, a rota continua a mesma e não duplica
  const salvas = rotas.map(r => (r.id === ra.id ? { ...r, nome: 'Ida pra Lavrinha', auto: false } : r));
  const de2 = organizarRotas(salvas, [...pedais, pedal('a4', IDA(), 7, T0 + 6 * DIA)]);
  assert.equal(de2.rotas.length, 2);
  assert.equal(de2.rotas.find(r => r.id === ra.id).nome, 'Ida pra Lavrinha');
  assert.equal(de2.tentativas[ra.id].length, 4);
  assert.equal(de2.mudou, false);
  // Apagou um pedal da rota automática B: ela some
  const sem = organizarRotas(de2.rotas, pedais.filter(p => p.id !== 'b2'));
  assert.equal(sem.rotas.some(r => r.id === rb.id), false);
});

test('estatísticas da rota: vezes, melhor, média e horários', () => {
  const pedais = [pedal('a1', IDA(4), 1, T0), pedal('a2', IDA(6), 2, T0 + DIA + 3600e3)];
  const e = estatisticasRota(['a1', 'a2'], pedais);
  assert.equal(e.vezes, 2);
  assert.equal(e.melhor.id, 'a2');
  assert.equal(e.horas[7], 1);
  assert.equal(e.horas[8], 1);
  assert.ok(e.media > e.melhor.tempoMov);
});

test('curva de tempo desconta as paradas', () => {
  const p = { tempoMov: 100, pontos: [[0, 0, 0], [0, 0.0005, 50], [0, 0.0010, 170]], paradas: [{ ini: 60, fim: 130 }] };
  const c = curvaTempo(p);
  assert.equal(c[1].t, 50);
  assert.equal(Math.round(c[2].t), 100);
});

test('guia: acompanha o caminho, sabe se está à frente do melhor e quando termina', () => {
  const melhor = pedal('a1', IDA(5), 1, T0);
  const rota = rotaDoPedal(melhor);
  for (const [v, sinal] of [[4, 1], [6.5, -1]]) {
    const g = new GuiaRota(rota, melhor);
    const novo = gerarPercurso(IDA(v), { semente: 9, t0: T0 });
    const evs = [];
    let meio = null;
    novo.leituras.forEach((f, i) => {
      evs.push(...g.atualizar(f.lat, f.lon, (f.t - T0) / 1000));
      if (i === Math.floor(novo.leituras.length / 2)) meio = { feito: g.feito, delta: g.delta };
    });
    assert.ok(evs.includes('concluiu'), `concluiu a ${v} m/s`);
    assert.ok(!evs.includes('saiu'), 'não saiu do caminho');
    assert.ok(Math.sign(meio.delta) === sinal && Math.abs(meio.delta) > 20, `a ${v} m/s, delta no meio ${meio.delta}`);
    assert.ok(Math.abs(meio.feito - g.total / 2) < 300, 'metade do caminho');
  }
  // Virou para o outro lado: sai da rota
  const g = new GuiaRota(rota, melhor);
  const errado = gerarPercurso(OUTRA(), { semente: 10, t0: T0 });
  const evs = errado.leituras.flatMap(f => g.atualizar(f.lat, f.lon, 0));
  assert.ok(evs.includes('saiu'));
  assert.ok(!evs.includes('concluiu'));
});
