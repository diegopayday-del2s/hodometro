// Recursos do app Android (Capacitor): GPS em segundo plano, voz, arquivos.
// No navegador nada disso existe e o app usa as APIs web.

export const ehNativo = () => {
  const cap = globalThis.Capacitor;
  return !!(cap && typeof cap.isNativePlatform === 'function' && cap.isNativePlatform());
};

let ponte = null;
const plugins = {};

/**
 * Chama um método de plugin nativo: chamar('Share', 'share', {...}).
 * O objeto do plugin nunca sai daqui: ele responde a qualquer nome, inclusive
 * "then", e quebraria se fosse devolvido por uma Promise.
 */
export async function chamar(nome, metodo, ...args) {
  if (!ehNativo()) throw new Error('Recurso só existe no app Android.');
  // capacitor-core.js é copiado para www/js/vendor por ferramentas/copiar-web.mjs
  if (!ponte) ponte = import('./vendor/capacitor-core.js');
  const modulo = await ponte;
  if (!plugins[nome]) plugins[nome] = modulo.registerPlugin(nome);
  return plugins[nome][metodo](...args);
}
