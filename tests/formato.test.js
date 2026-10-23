import { test } from 'node:test';
import assert from 'node:assert/strict';
import * as F from '../js/formato.js';
import { gerarGPX } from '../js/gpx.js';

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
  assert.match(F.falaKm(3, 180, 5.5556), /^3 quilômetros\. Último quilômetro em 3 minutos\. Média de 20,0/);
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
