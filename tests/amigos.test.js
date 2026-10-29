// Testes dos amigos: arquivo de envio, junção, ranking e pedal junto.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { gerarPacote, lerPacote, juntarAmigo, ranking, juntos, companhia, comparar, rankingRota, simplificar, novoPerfil, nomeAmigo, posicaoEm, MAX_ENVIO } from '../js/amigos.js';
import { gerarPercurso } from '../js/simulador.js';
import { rotaDoPedal } from '../js/rotas.js';
import { distancia } from '../js/geo.js';

const T0 = new Date(2026, 9, 24, 7, 0).getTime();   // sábado
const agora = new Date(2026, 9, 28, 20).getTime();   // quarta seguinte
const IDA = (v = 5) => [{ tipo: 'reta', dist: 1200, vel: v, rumo: 0 }, { tipo: 'curva', raio: 15, graus: 90, vel: 4 }, { tipo: 'reta', dist: 900, vel: v }];

function pedal(id, trechos, semente, inicio, opcoes = {}) {
  const g = gerarPercurso(trechos, { semente, t0: inicio, ...opcoes });
  const pontos = g.leituras.map(f => [f.lat, f.lon, (f.t - inicio) / 1000, f.alt]);
  return { id, via: 'gps', inicio, fim: inicio + g.totalReal * 1000, distancia: Math.round(g.distReal), tempoMov: Math.round(g.movReal), tempoTotal: Math.round(g.totalReal), velMax: 6, subida: 5, pausas: 0, tempoPausas: 0, parciais: [{ km: 1, tempo: 200 }], paradas: [], lacunas: [], pontos };
}

test('perfil novo tem id e nome limpo', () => {
  const p = novoPerfil('  Diego   P ', 1000, () => 0.123456789);
  assert.match(p.id, /^u[0-9a-z]+$/);
  assert.equal(p.nome, 'Diego P');
  assert.equal(nomeAmigo({ nome: 'Valeria' }), 'Valeria');
  assert.equal(nomeAmigo({ nome: 'Valeria', apelido: 'Val' }), 'Val');
});

test('trajeto simplificado: menos pontos, mesmas pontas e lacunas renumeradas', () => {
  const p = pedal('a', IDA(), 1, T0);
  p.lacunas = [{ i: 200, dist: 30 }];
  const s = simplificar(p.pontos, p.lacunas);
  assert.ok(s.pontos.length < p.pontos.length / 2, `${s.pontos.length} de ${p.pontos.length}`);
  assert.deepEqual(s.pontos[0].slice(0, 2), [Math.round(p.pontos[0][0] * 1e5) / 1e5, Math.round(p.pontos[0][1] * 1e5) / 1e5]);
  assert.equal(s.lacunas.length, 1);
  const j = s.lacunas[0].i;
  assert.ok(Math.abs(s.pontos[j][2] - Math.round(p.pontos[200][2])) <= 1, 'a lacuna aponta para o mesmo ponto');
  assert.ok(Math.abs(s.pontos[j - 1][2] - Math.round(p.pontos[199][2])) <= 1, 'e começa no ponto de antes');
  // Nenhum trecho mantido passa muito dos 15 m (fora as pontas obrigatórias)
  const passos = s.pontos.slice(1).map((q, i) => distancia(s.pontos[i][0], s.pontos[i][1], q[0], q[1]));
  assert.ok(passos.every(d => d < 40), 'passos curtos');
});

test('o arquivo do amigo vai e volta sem perder os números', () => {
  const eu = { id: 'u1', nome: 'Diego' };
  const meus = [pedal('a', IDA(), 1, T0), pedal('b', IDA(4), 2, T0 + 864e5), { id: 'd', via: 'gps', inicio: T0, distancia: 9000, tempoMov: 1000, demo: true }];
  const pac = gerarPacote(eu, meus, { agora });
  assert.equal(pac.app, 'hodometro');
  assert.equal(pac.pedais.length, 2, 'demonstração não vai');
  assert.equal(pac.resumo.n, 2);
  assert.equal(pac.pedais[0].id, 'b', 'mais recente primeiro');
  const lido = lerPacote(JSON.stringify(pac));
  assert.equal(lido.perfil.nome, 'Diego');
  assert.equal(lido.pedais[1].distancia, meus[0].distancia);
  assert.ok(lido.pedais[1].pontos.length > 10);
  // Só os números
  const so = lerPacote(gerarPacote(eu, meus, { comTrajeto: false, agora }));
  assert.ok(so.pedais.every(p => p.pontos.length === 0));
  // No máximo MAX_ENVIO pedais, mas o resumo conta todos
  const muitos = Array.from({ length: 30 }, (_, i) => ({ id: 'p' + i, via: 'manual', inicio: T0 - i * 864e5, distancia: 1000, tempoMov: 300 }));
  const grande = gerarPacote(eu, muitos, { agora });
  assert.equal(grande.pedais.length, MAX_ENVIO);
  assert.equal(grande.resumo.n, 30);
  assert.equal(grande.resumo.distancia, 30000);
});

test('arquivo estranho ou de versão nova é recusado', () => {
  assert.throws(() => lerPacote('não é json'), e => e.code === 'formato');
  assert.throws(() => lerPacote({ app: 'hodometro', pedais: [] }), e => e.code === 'formato');
  assert.throws(() => lerPacote({ app: 'hodometro', tipo: 'amigo', versao: 9, perfil: { id: 'x' } }), e => e.code === 'versao');
  const sujo = lerPacote({ app: 'hodometro', tipo: 'amigo', versao: 1, perfil: { id: 'u9', nome: 'x'.repeat(200) }, pedais: [{ id: 'ok', inicio: T0, distancia: 10, pontos: [[1, 2, 0], ['a', 2], [999, 0, 1]] }, { id: 3 }, null] });
  assert.equal(sujo.perfil.nome.length, 40);
  assert.equal(sujo.pedais.length, 1);
  assert.equal(sujo.pedais[0].pontos.length, 1, 'só o ponto válido');
});

test('receber de novo atualiza o amigo sem duplicar pedais', () => {
  const val = { id: 'u2', nome: 'Valeria' };
  const p1 = pedal('v1', IDA(), 3, T0), p2 = pedal('v2', IDA(), 4, T0 + 864e5);
  let r = juntarAmigo([], lerPacote(gerarPacote(val, [p1], { agora: agora - 1000 })), agora);
  assert.equal(r.novo, true);
  assert.equal(r.novos, 1);
  const comMapa = r.amigos[0].pedais[0].pontos.length;
  r = juntarAmigo(r.amigos, lerPacote(gerarPacote({ ...val, nome: 'Val' }, [p1, p2], { comTrajeto: false, agora })), agora + 1);
  assert.equal(r.novo, false);
  assert.equal(r.novos, 1);
  assert.equal(r.amigos.length, 1);
  assert.equal(r.amigo.nome, 'Val', 'nome do envio mais novo');
  assert.equal(r.amigo.pedais.length, 2);
  assert.equal(r.amigo.pedais.find(p => p.id === 'v1').pontos.length, comMapa, 'o trajeto que já tinha fica');
  // Envio mais velho chegando depois não troca o resumo
  const velho = lerPacote(gerarPacote({ ...val, nome: 'Antigo' }, [p1], { agora: agora - 5000 }));
  assert.equal(juntarAmigo(r.amigos, velho, agora + 2).amigo.nome, 'Val');
});

test('ranking da semana e desde o começo', () => {
  const eu = { nome: 'Diego', pedais: [{ id: 'a', inicio: agora - 864e5, distancia: 8000, tempoMov: 1800 }, { id: 'b', inicio: T0 - 30 * 864e5, distancia: 50000, tempoMov: 9000 }] };
  const amigos = [{ id: 'u2', nome: 'Valeria', pedais: [{ id: 'v', inicio: agora - 2 * 864e5, distancia: 12000, tempoMov: 2400 }], resumo: { n: 9, distancia: 40000, tempoMov: 8000, velMedia: 5 } }];
  const sem = ranking(eu, amigos, 'semana', agora);
  assert.deepEqual(sem.map(l => l.nome), ['Valeria', 'Diego']);
  assert.equal(sem[1].voce, true);
  const tot = ranking(eu, amigos, 'total', agora);
  assert.deepEqual(tot.map(l => l.distancia), [58000, 40000]);
  assert.equal(tot[1].n, 9, 'o amigo conta todos os pedais dele pelo resumo');
});

test('pedal junto: mesmo horário e lado a lado', () => {
  const meu = pedal('m', IDA(), 5, T0);
  const dela = pedal('v', IDA(5.05), 6, T0 + 20000);           // outro celular, saiu 20 s depois
  const outroDia = pedal('o', IDA(), 7, T0 + 864e5);
  const longe = pedal('l', IDA(), 8, T0, { lat0: -23.6, lon0: -46.7 });
  assert.equal(juntos(meu, dela), true);
  assert.equal(juntos(meu, outroDia), false);
  assert.equal(juntos(meu, longe), false, 'mesma hora, outro lugar');
  const pos = posicaoEm(meu, T0 + 60000);
  assert.ok(pos && Math.abs(pos[0] - meu.pontos[60][0]) < 1e-3);
  assert.equal(posicaoEm(meu, T0 - 1000), null);
  const amigos = [{ id: 'u2', nome: 'Valeria', pedais: [outroDia, dela] }, { id: 'u3', nome: 'Ana', pedais: [longe] }];
  const c = companhia(meu, amigos);
  assert.equal(c.length, 1);
  assert.equal(c[0].amigo.nome, 'Valeria');
  assert.equal(c[0].pedal.id, 'v');
  const cmp = comparar(meu, dela);
  assert.equal(cmp.distancia.eu, meu.distancia);
  assert.ok(Math.abs(cmp.distancia.pct) < 0.05, 'mesmo caminho, distância parecida');
  // Sem trajeto: só pelo horário e pela distância
  const semMapa = { ...dela, pontos: [] };
  assert.equal(juntos({ ...meu, pontos: [] }, semMapa), true);
});

test('ranking da rota com os amigos', () => {
  const meu1 = pedal('m1', IDA(), 9, T0), meu2 = pedal('m2', IDA(5.5), 10, T0 + 864e5);
  const rota = rotaDoPedal(meu1, false, agora);
  const dela = pedal('v', IDA(6), 11, T0 + 2 * 864e5);
  const outra = pedal('o', [{ tipo: 'reta', dist: 2100, vel: 5, rumo: 90 }], 12, T0);
  const linhas = rankingRota(rota, ['m1', 'm2'], [meu1, meu2], [{ id: 'u2', nome: 'Valeria', pedais: [dela, outra] }], 'Você');
  assert.equal(linhas.length, 2);
  assert.equal(linhas[0].nome, 'Valeria', 'mais rápida');
  assert.equal(linhas[0].vezes, 1, 'o outro caminho não conta');
  assert.equal(linhas[1].voce, true);
  assert.equal(linhas[1].pedal.id, 'm2', 'seu melhor tempo');
});
