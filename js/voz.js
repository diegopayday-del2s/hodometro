// Avisos falados com a voz do próprio celular (funciona offline na maioria dos aparelhos).
// No app Android usa a voz do sistema, que fala mesmo com a tela apagada.
import { ehNativo, chamar } from './nativo.js';

let voz = null;
const temWeb = () => 'speechSynthesis' in globalThis && 'SpeechSynthesisUtterance' in globalThis;

export const temVoz = () => ehNativo() || temWeb();

function escolherVoz() {
  const vozes = speechSynthesis.getVoices();
  voz = vozes.find(v => /^pt[-_]BR$/i.test(v.lang)) || vozes.find(v => /^pt/i.test(v.lang)) || null;
}

if (temWeb()) {
  escolherVoz();
  speechSynthesis.addEventListener?.('voiceschanged', escolherVoz);
}

export function falar(texto) {
  if (ehNativo()) {
    chamar('TextToSpeech', 'speak', { text: texto, lang: 'pt-BR', rate: 1.0, pitch: 1.0, volume: 1.0, category: 'playback', queueStrategy: 0 })
      .catch(() => {});
    return true;
  }
  if (!temWeb()) return false;
  if (!voz) escolherVoz();
  const u = new SpeechSynthesisUtterance(texto);
  u.lang = 'pt-BR';
  if (voz) u.voice = voz;
  u.rate = 1;
  speechSynthesis.cancel();
  speechSynthesis.speak(u);
  return true;
}
