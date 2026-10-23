// Testes do motor de cálculo com pedais simulados.
// Rodar: npm test   (ou: node --test)
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { Rastreador } from '../js/rastreador.js';
import { gerarPercurso, PEDAL_DEMO } from '../js/simulador.js';

const KMH = 1 / 3.6;

function rodar(leituras, cfg = {}, acoes = {}) {
  const inicio = leituras[0].t - 2000;
  let r = new Rastreador(cfg, inicio);
  leituras.forEach((f, i) => {
    if (acoes[i]) r = acoes[i](r, f) || r;
    r.push(f);
    r.tick(f.t);
  });
  return { r, res: r.finalizar(leituras[leituras.length - 1].t + 1000) };
}

function perto(real, esperado, tolRel, msg) {
  const erro = Math.abs(real - esperado) / esperado;
  assert.ok(erro <= tolRel, `${msg}: deu ${real.toFixed(1)}, esperado ${esperado.toFixed(1)} (erro ${(erro * 100).toFixed(2)}%)`);
}
function dentro(real, esperado, tolAbs, msg) {
  assert.ok(Math.abs(real - esperado) <= tolAbs, `${msg}: deu ${real.toFixed(1)}, esperado ${esperado.toFixed(1)} ± ${tolAbs}`);
}

for (const doppler of [true, false]) {
  const nome = doppler ? 'com velocidade do aparelho' : 'sem velocidade do aparelho';

  test(`reta de 5 km a 20 km/h (${nome})`, () => {
    for (const semente of [1, 2, 3]) {
      const g = gerarPercurso([{ tipo: 'reta', dist: 5000, vel: 20 * KMH }], { doppler, semente });
      const { res } = rodar(g.leituras);
      perto(res.distancia, 5000, 0.015, `distância (semente ${semente})`);
      dentro(res.tempoMov, g.movReal, 6, 'tempo em movimento');
      perto(res.distancia / res.tempoMov * 3.6, 20, 0.02, 'velocidade média');
      assert.equal(res.parciais.length, Math.floor(res.distancia / 1000), 'uma parcial por km completo');
      assert.ok(res.parciais.length >= 4, 'parciais por km');
      for (const p of res.parciais) dentro(p.tempo, 180, 8, `parcial km ${p.km}`);
      assert.equal(res.pausas, 0, 'sem pausas');
    }
  });

  test(`semáforo de 2 min no meio (${nome})`, () => {
    for (const semente of [4, 5, 6]) {
      const g = gerarPercurso([
        { tipo: 'reta', dist: 1000, vel: 20 * KMH },
        { tipo: 'parada', dur: 120 },
        { tipo: 'reta', dist: 1000, vel: 20 * KMH },
      ], { doppler, semente });
      const { res } = rodar(g.leituras);
      perto(res.distancia, 2000, 0.02, `distância (semente ${semente})`);
      assert.equal(res.pausas, 1, 'uma pausa');
      dentro(res.tempoPausas, 120, 10, 'tempo parado');
      dentro(res.tempoMov, 360, 10, 'tempo em movimento');
    }
  });

  test(`parado 10 min com o GPS tremendo não soma distância (${nome})`, () => {
    const g = gerarPercurso([{ tipo: 'parada', dur: 600 }], { doppler, semente: 9, ruido: 6 });
    const { res } = rodar(g.leituras);
    assert.ok(res.distancia < 15, `distância ${res.distancia}`);
    assert.ok(res.tempoMov < 10, `tempo em movimento ${res.tempoMov}`);
    assert.equal(res.pausas, 0);
  });

  test(`pedal devagar a 7 km/h não vira pausa (${nome})`, () => {
    const g = gerarPercurso([{ tipo: 'reta', dist: 1000, vel: 7 * KMH }], { doppler, semente: 11 });
    const { res } = rodar(g.leituras);
    perto(res.distancia, 1000, 0.03, 'distância');
    assert.equal(res.pausas, 0, 'pausas');
    dentro(res.tempoMov, g.movReal, 12, 'tempo em movimento');
  });

  test(`curvas: 20 voltas num círculo de 40 m (${nome})`, () => {
    const voltas = Array.from({ length: 20 }, () => ({ tipo: 'curva', raio: 40, graus: 360, vel: 15 * KMH }));
    const g = gerarPercurso(voltas, { doppler, semente: 12 });
    const { res } = rodar(g.leituras);
    perto(res.distancia, g.distReal, 0.03, 'distância');
  });
}

test('saltos do GPS de 200 a 500 m são ignorados', () => {
  const tr = [];
  for (let i = 0; i < 6; i++) {
    tr.push({ tipo: 'reta', dist: 500, vel: 18 * KMH, rumo: i * 30 });
    tr.push({ tipo: 'salto', dist: 200 + i * 60 });
  }
  const g = gerarPercurso(tr, { semente: 13 });
  const { res } = rodar(g.leituras);
  perto(res.distancia, 3000, 0.02, 'distância');
});

test('trecho com precisão ruim (60 m) é ignorado sem perder a distância', () => {
  const g = gerarPercurso([
    { tipo: 'reta', dist: 1500, vel: 18 * KMH },
    { tipo: 'ruim', acc: 60, trecho: { tipo: 'reta', dist: 200, vel: 18 * KMH } },
    { tipo: 'reta', dist: 1500, vel: 18 * KMH },
  ], { semente: 14 });
  const { res } = rodar(g.leituras);
  perto(res.distancia, 3200, 0.02, 'distância');
  dentro(res.tempoMov, g.movReal, 12, 'tempo em movimento');
});

test('tela bloqueada 3 min pedalando em reta: soma o trecho', () => {
  const g = gerarPercurso([
    { tipo: 'reta', dist: 1500, vel: 18 * KMH },
    { tipo: 'semSinal', trecho: { tipo: 'reta', dist: 900, vel: 18 * KMH } },
    { tipo: 'reta', dist: 1500, vel: 18 * KMH },
  ], { semente: 15 });
  const { res } = rodar(g.leituras);
  perto(res.distancia, 3900, 0.02, 'distância');
  dentro(res.tempoMov, g.movReal, 12, 'tempo em movimento');
  assert.equal(res.lacunas.length, 1, 'marca o trecho sem sinal');
});

test('tela bloqueada 5 min parado no semáforo: vira pausa', () => {
  const g = gerarPercurso([
    { tipo: 'reta', dist: 1500, vel: 18 * KMH },
    { tipo: 'semSinal', trecho: { tipo: 'parada', dur: 300 } },
    { tipo: 'reta', dist: 1500, vel: 18 * KMH },
  ], { semente: 16 });
  const { res } = rodar(g.leituras);
  perto(res.distancia, 3000, 0.02, 'distância');
  dentro(res.tempoMov, g.movReal, 12, 'tempo em movimento');
  assert.equal(res.pausas, 1, 'pausas');
});

test('pausa manual: o que andou pausado não conta', () => {
  const g = gerarPercurso([
    { tipo: 'reta', dist: 1000, vel: 18 * KMH },
    { tipo: 'reta', dist: 300, vel: 5 * KMH },
    { tipo: 'reta', dist: 1000, vel: 18 * KMH },
  ], { semente: 17 });
  const n1 = Math.round(1000 / (18 * KMH));
  const n2 = n1 + Math.round(300 / (5 * KMH));
  const { res } = rodar(g.leituras, {}, {
    [n1]: (r, f) => { r.pausar(f.t - 1); },
    [n2]: (r, f) => { r.retomar(f.t - 1); },
  });
  perto(res.distancia, 2000, 0.025, 'distância');
  assert.equal(res.pausas, 1, 'pausas');
  dentro(res.tempoMov, 400, 12, 'tempo em movimento');
});

test('pausa automática desligada: parada conta como tempo em movimento', () => {
  const g = gerarPercurso([
    { tipo: 'reta', dist: 1000, vel: 20 * KMH },
    { tipo: 'parada', dur: 120 },
    { tipo: 'reta', dist: 1000, vel: 20 * KMH },
  ], { semente: 18 });
  const { res } = rodar(g.leituras, { autoPausa: false });
  assert.equal(res.pausas, 0);
  dentro(res.tempoMov, 480, 6, 'tempo em movimento');
  assert.ok(res.distancia < 2060 && res.distancia > 1960, `distância ${res.distancia}`);
});

test('velocidade máxima ignora pico isolado', () => {
  const g = gerarPercurso([
    { tipo: 'reta', dist: 1000, vel: 20 * KMH },
    { tipo: 'reta', dist: 750, vel: 45 * KMH },
    { tipo: 'reta', dist: 1000, vel: 20 * KMH },
  ], { semente: 19 });
  g.leituras[100].vel = 90 * KMH;   // pico falso do Doppler
  const { res } = rodar(g.leituras);
  dentro(res.velMax * 3.6, 45, 3, 'velocidade máxima km/h');
});

test('subida acumulada aproximada', () => {
  const g = gerarPercurso([
    { tipo: 'reta', dist: 2000, vel: 12 * KMH, subida: 50 },
    { tipo: 'reta', dist: 2000, vel: 25 * KMH, subida: -50 },
  ], { semente: 20 });
  const { res } = rodar(g.leituras);
  dentro(res.subida, 50, 15, 'subida');
  const plano = gerarPercurso([{ tipo: 'reta', dist: 4000, vel: 18 * KMH }], { semente: 21 });
  assert.ok(rodar(plano.leituras).res.subida < 15, 'plano quase sem subida');
});

test('salvar e recuperar no meio dá o mesmo resultado', () => {
  const g = gerarPercurso(PEDAL_DEMO, { semente: 22 });
  const direto = rodar(g.leituras).res;
  const inicio = g.leituras[0].t - 2000;
  let r = new Rastreador({}, inicio);
  g.leituras.forEach((f, i) => {
    if (i % 400 === 399) r = Rastreador.deJSON(JSON.parse(JSON.stringify(r)));
    r.push(f); r.tick(f.t);
  });
  const recuperado = r.finalizar(g.leituras[g.leituras.length - 1].t + 1000);
  assert.deepEqual(recuperado, direto);
});

test('pedal de demonstração: números coerentes', () => {
  const g = gerarPercurso(PEDAL_DEMO, { semente: 23 });
  const { res } = rodar(g.leituras);
  perto(res.distancia, g.distReal, 0.025, 'distância');
  dentro(res.tempoMov, g.movReal, 15, 'tempo em movimento');
  assert.equal(res.pausas, 2, 'duas paradas no meio (a do fim não conta)');
  assert.ok(res.tempoMov + res.tempoPausas <= res.tempoTotal + 1, 'tempos fecham');
  const somaParciais = res.parciais.reduce((a, p) => a + p.tempo, 0);
  assert.ok(somaParciais <= res.tempoMov + 1, 'parciais cabem no tempo em movimento');
});

test('leitura repetida, antiga ou inválida não quebra nada', () => {
  const r = new Rastreador({}, 1000);
  r.push({ t: 500, lat: -23.5, lon: -46.6, acc: 5 });
  r.push({ t: 2000, lat: NaN, lon: -46.6, acc: 5 });
  r.push({ t: 2000, lat: -23.5, lon: -46.6, acc: 5 });
  r.push({ t: 2000, lat: -23.5, lon: -46.6, acc: 5 });
  r.push({ t: 3000, lat: -23.5, lon: -46.6 });
  const res = r.finalizar(4000);
  assert.equal(res.distancia, 0);
  assert.equal(res.pontos.length, 1);
});

test('estabilidade: 20 sementes do pedal de demonstração, com e sem Doppler', () => {
  for (const doppler of [true, false]) {
    for (let semente = 100; semente < 120; semente++) {
      const g = gerarPercurso(PEDAL_DEMO, { semente, doppler });
      const { res } = rodar(g.leituras);
      perto(res.distancia, g.distReal, doppler ? 0.015 : 0.03, `distância (semente ${semente}, doppler ${doppler})`);
      dentro(res.tempoMov, g.movReal, doppler ? 15 : 25, `tempo em movimento (semente ${semente}, doppler ${doppler})`);
      assert.equal(res.pausas, 2, `pausas (semente ${semente}, doppler ${doppler})`);
    }
  }
});
