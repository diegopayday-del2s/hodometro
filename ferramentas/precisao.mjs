// Relatório de precisão do motor com pedais simulados.
// Rodar: npm run precisao
// Use antes e depois de mexer em qualquer limiar de js/rastreador.js.
import { Rastreador } from '../js/rastreador.js';
import { gerarPercurso, PEDAL_DEMO, sorteador } from '../js/simulador.js';

const KMH = 1 / 3.6;
const CENARIOS = {
  'reta 5 km a 20 km/h': [{ tipo: 'reta', dist: 5000, vel: 20 * KMH }],
  'semáforo de 2 min': [{ tipo: 'reta', dist: 1000, vel: 20 * KMH }, { tipo: 'parada', dur: 120 }, { tipo: 'reta', dist: 1000, vel: 20 * KMH }],
  'devagar a 7 km/h': [{ tipo: 'reta', dist: 1000, vel: 7 * KMH }],
  'círculo de 40 m': Array.from({ length: 20 }, () => ({ tipo: 'curva', raio: 40, graus: 360, vel: 15 * KMH })),
  'esquinas de cidade': Array.from({ length: 12 }, () => [{ tipo: 'reta', dist: 150, vel: 16 * KMH }, { tipo: 'curva', raio: 8, graus: 90, vel: 3.5 }]).flat(),
  'pedal de demonstração': PEDAL_DEMO,
};

function rodar(trechos, opcoes, perda = 0) {
  const g = gerarPercurso(trechos, opcoes);
  const sorte = sorteador(opcoes.semente * 7 + 1);
  const leituras = g.leituras.filter(() => sorte() >= perda);
  const r = new Rastreador({}, leituras[0].t - 2000);
  for (const f of leituras) { r.push(f); r.tick(f.t); }
  const res = r.finalizar(leituras[leituras.length - 1].t + 1000);
  return { erroDist: (res.distancia - g.distReal) / g.distReal * 100, erroMov: res.tempoMov - g.movReal, pausas: res.pausas };
}

const linhas = [];
for (const [nome, trechos] of Object.entries(CENARIOS)) {
  for (const doppler of [true, false]) {
    for (const perda of [0, 0.2]) {
      const r = Array.from({ length: 10 }, (_, i) => rodar(trechos, { semente: 1 + i, doppler }, perda));
      const piorD = Math.max(...r.map(x => Math.abs(x.erroDist)));
      const mediaD = r.reduce((a, x) => a + x.erroDist, 0) / r.length;
      const piorT = Math.max(...r.map(x => Math.abs(x.erroMov)));
      linhas.push({
        cenario: nome,
        velocidade: doppler ? 'aparelho' : 'só posição',
        perdas: `${perda * 100}%`,
        'distância média %': mediaD.toFixed(2),
        'distância pior %': piorD.toFixed(2),
        'tempo pior s': piorT.toFixed(0),
      });
    }
  }
}
console.table(linhas);
