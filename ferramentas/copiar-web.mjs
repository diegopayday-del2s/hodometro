// Monta a pasta www/ que vai dentro do app Android (Capacitor).
// O app web continua na raiz do repositório (GitHub Pages); aqui só copiamos.
// Rodar: npm run web
import { cpSync, rmSync, mkdirSync, readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const raiz = join(dirname(fileURLToPath(import.meta.url)), '..');
const destino = join(raiz, 'www');

// A lista oficial dos arquivos do app é a do service worker
const sw = readFileSync(join(raiz, 'sw.js'), 'utf8');
const lista = [...sw.matchAll(/^\s*'([^']+)',?$/gm)].map(m => m[1]).filter(a => a !== './');

rmSync(destino, { recursive: true, force: true });
mkdirSync(destino, { recursive: true });
for (const arq of [...lista, 'sw.js']) {
  mkdirSync(dirname(join(destino, arq)), { recursive: true });
  cpSync(join(raiz, arq), join(destino, arq));
}
// Ponte para os recursos nativos (GPS em segundo plano, voz, compartilhar)
mkdirSync(join(destino, 'js/vendor'), { recursive: true });
cpSync(join(raiz, 'node_modules/@capacitor/core/dist/index.js'), join(destino, 'js/vendor/capacitor-core.js'));
console.log(`www/ pronto com ${lista.length + 2} arquivos.`);
