// Avisos falados com a voz do próprio celular (funciona offline na maioria dos aparelhos).

let voz = null;

export const temVoz = () => 'speechSynthesis' in globalThis && 'SpeechSynthesisUtterance' in globalThis;

function escolherVoz() {
  const vozes = speechSynthesis.getVoices();
  voz = vozes.find(v => /^pt[-_]BR$/i.test(v.lang)) || vozes.find(v => /^pt/i.test(v.lang)) || null;
}

if (temVoz()) {
  escolherVoz();
  speechSynthesis.addEventListener?.('voiceschanged', escolherVoz);
}

export function falar(texto) {
  if (!temVoz()) return false;
  if (!voz) escolherVoz();
  const u = new SpeechSynthesisUtterance(texto);
  u.lang = 'pt-BR';
  if (voz) u.voice = voz;
  u.rate = 1;
  speechSynthesis.cancel();
  speechSynthesis.speak(u);
  return true;
}
