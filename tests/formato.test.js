import { test } from 'node:test';
import assert from 'node:assert/strict';
import * as F from '../js/formato.js';
import { gerarGPX, lerGPX, converterGPXEmPedal } from '../js/gpx.js';

test('formatos de tempo, distância e ritmo', () => {
  assert.equal(F.duracao(0), '00:00');
  assert.equal(F.duracao(59.6), '01:00');
  assert.equal(F.duracao(3725), '1:02:05');
  assert.equal(F.horasMin(2700), '0:45');
  assert.equal(F.ritmo(170), '2:50');
  assert.equal(F.ritmo(null), '--');
  assert.equal(F.kmAoVivo(4999), '4,99');
  assert.equal(F.km1(4960), '5,0');
  assert.equal(F.kmh(5.5556), '20,0');
  assert.equal(F.duracaoFalada(192), '3 minutos e 12 segundos');
  assert.equal(F.duracaoFalada(3601), '1 hora e 1 segundo');
  assert.match(F.falaKm(3, 180, 5.5556), /^3 quilômetros\. Média de 20,0 quilômetros por hora\. Último quilômetro em 3 minutos\.$/);
});

test('recordes ignoram demonstração e pedais sem GPS', () => {
  const base = { via: 'gps', inicio: Date.now(), parciais: [{ km: 1, tempo: 200 }], subida: 10, velMax: 8 };
  const pedais = [
    { ...base, id: 'a', distancia: 6000, tempoMov: 1200 },
    { ...base, id: 'b', distancia: 9000, tempoMov: 1500, demo: true, parciais: [{ km: 1, tempo: 100 }] },
    { ...base, id: 'c', distancia: 20000, tempoMov: 3000, via: 'manual', parciais: [] },
  ];
  const r = F.recordes(pedais);
  assert.equal(r.maiorDistancia.id, 'a');
  assert.equal(r.melhorKm.valor, 200);
  assert.equal(r.maiorMedia.id, 'a');
});

test('semana vai de segunda a domingo', () => {
  const quarta = new Date(2026, 9, 21, 10).getTime();
  const dias = F.semana([{ inicio: quarta, distancia: 8400 }], quarta);
  assert.equal(dias.length, 7);
  assert.equal(dias[0].data.getDay(), 1);
  assert.equal(dias[2].distancia, 8400);
});

test('GPX válido, com tempo e quebra nos trechos sem sinal', () => {
  const p = { inicio: Date.UTC(2026, 9, 23, 10), pontos: [[-23.5, -46.6, 0, 760], [-23.501, -46.6, 10, 761], [-23.51, -46.6, 200, null]], lacunas: [{ i: 2, dist: 1000 }] };
  const xml = gerarGPX(p, 'Pedal & teste');
  assert.match(xml, /<gpx version="1.1"/);
  assert.equal((xml.match(/<trkseg>/g) || []).length, 2);
  assert.match(xml, /<time>2026-10-23T10:00:10.000Z<\/time>/);
  assert.match(xml, /Pedal &amp; teste/);
  assert.doesNotMatch(xml, /<ele>null/);
});

test('importação e conversão de GPX para pedal', () => {
  const pOriginal = {
    inicio: Date.UTC(2026, 9, 24, 8, 0, 0),
    pontos: [
      [-23.5505, -46.6333, 0, 760],
      [-23.5510, -46.6338, 10, 762],
      [-23.5520, -46.6345, 25, 765],
      [-23.5530, -46.6355, 45, 768]
    ],
    lacunas: []
  };
  const gpx = gerarGPX(pOriginal, 'Trilha da Serra');
  const { nome, pontos } = lerGPX(gpx);
  assert.equal(nome, 'Trilha da Serra');
  assert.equal(pontos.length, 4);
  assert.equal(pontos[0].alt, 760);

  const pedal = converterGPXEmPedal(gpx);
  assert.equal(pedal.nome, 'Trilha da Serra');
  assert.equal(pedal.via, 'gps');
  assert.equal(pedal.importado, 'gpx');
  assert.ok(pedal.distancia > 200);
  assert.ok(pedal.tempoMov > 0);
  assert.ok(pedal.pontos.length >= 2);
});

test('estatísticas somam geral, mês e semana sem a demonstração', () => {
  const agora = new Date(2026, 9, 24, 18).getTime();
  const pedais = [
    { id: 'a', via: 'gps', inicio: new Date(2026, 9, 24, 17).getTime(), distancia: 3200, tempoMov: 700, velMax: 9, parciais: [] },
    { id: 'b', via: 'gps', inicio: new Date(2026, 9, 2, 8).getTime(), distancia: 10000, tempoMov: 2000, velMax: 12, parciais: [] },
    { id: 'c', via: 'manual', inicio: new Date(2026, 8, 20, 12).getTime(), distancia: 5000, tempoMov: 0, velMax: 0, parciais: [] },
    { id: 'd', via: 'gps', demo: true, inicio: agora - 1000, distancia: 6000, tempoMov: 1000, velMax: 20, parciais: [] },
  ];
  const e = F.estatisticas(pedais, agora);
  assert.equal(e.geral.distancia, 18200);
  assert.equal(e.geral.n, 3);
  assert.equal(e.mes.distancia, 13200);
  assert.equal(e.semana.distancia, 3200);
  assert.equal(e.geral.tempoMov, 2700);
  assert.equal(e.recordes.maiorDistancia.id, 'b');
  assert.equal(e.recordes.maiorVel.id, 'b');
  assert.equal(F.horasLongas(2700), '45 min');
  assert.equal(F.horasLongas(224100), '62 h 15 min');
});

test('notificação e resumo em texto', () => {
  const n = F.textoNotificacao({ estado: 'movendo', sinal: 'ok', distancia: 12345, velAtual: 5, tempoMov: 2472, velMedia: 5 });
  assert.equal(n.titulo, '12,34 km  ·  18,0 km/h');
  assert.equal(n.texto, 'Em movimento 41:12 · média 18,0 km/h');
  assert.match(F.textoNotificacao({ estado: 'parado', distancia: 500, velAtual: 0, tempoMov: 100, velMedia: 5 }).texto, /^Pausa automática/);
  const p = { via: 'gps', inicio: new Date(2026, 9, 24, 17, 42).getTime(), distancia: 3200, tempoMov: 720, tempoTotal: 800, velMax: 8, subida: 12, pausas: 1 };
  const t = F.resumoTexto(p, 'Pedal da tarde');
  assert.match(t, /^Pedal da tarde · sáb, 24\/10\/2026, 17:42\n/);
  assert.match(t, /Distância: 3,20 km/);
  assert.match(t, /Velocidade média: 16,0 km\/h/);
  assert.match(t, /Tempo total: 13:20 \(1 pausa\)/);
  assert.doesNotMatch(t, /—/);
});

test('tempo curto, data por extenso e números dos stories', async () => {
  const { numerosStory } = await import('../js/story.js');
  assert.equal(F.tempoCurto(5400), '1h 30m');
  assert.equal(F.tempoCurto(2472), '41m 12s');
  assert.equal(F.tempoCurto(45), '45s');
  const t = new Date(2026, 9, 24, 13, 5).getTime();
  assert.equal(F.quandoLongo(t, true, t), 'sábado, 24 de outubro às 13:05');
  const n = numerosStory({ via: 'gps', distancia: 23700, subida: 156, tempoMov: 5400 });
  assert.deepEqual(n.map(x => x.valor), ['23,70 km', '156 m', '1h 30m']);
  const m = numerosStory({ via: 'manual', distancia: 3200, subida: 0, tempoMov: 720 });
  assert.deepEqual(m.map(x => x.rotulo), ['Distância', 'Tempo', 'Velocidade média']);
  assert.match(F.textoNotificacao({ estado: 'movendo', sinal: 'ok', distancia: 1000, velAtual: 5, tempoMov: 200, velMedia: 5 }, 'faltam 2,10 km').texto, / · faltam 2,10 km$/);
});
