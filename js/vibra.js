// Vibração para os avisos com o celular no bolso. No app Android vibra pelo
// sistema, mesmo com a tela apagada. No navegador usa navigator.vibrate.
import { ehNativo, chamar } from './nativo.js';

/** [vibra, pausa, vibra, ...] em ms. Cada aviso tem um ritmo diferente. */
export const PADROES = Object.freeze({
  km: [300, 150, 300],                 // dois toques médios
  parou: [700],                        // um toque longo
  retomou: [120, 90, 120, 90, 120],    // três toques curtos
  inicio: [200],
  fim: [500, 150, 500],
  fora: [600, 200, 600, 200, 600],     // saiu da rota: três toques longos
  toque: [30],
});

export const temVibracao = () => ehNativo() || (typeof navigator !== 'undefined' && 'vibrate' in navigator);

export function vibrar(nome) {
  const padrao = PADROES[nome] || nome;
  if (ehNativo()) {
    chamar('Gravador', 'vibrar', { padrao }).catch(() => {});
    return true;
  }
  try { return !!navigator.vibrate(padrao); } catch { return false; }
}
