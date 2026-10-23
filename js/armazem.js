// Guarda os pedais no próprio celular (IndexedDB). Funciona sem internet.
// Se o IndexedDB falhar (modo anônimo de alguns navegadores), usa o localStorage.

const NOME = 'hodometro';
const VERSAO = 1;
let promessa = null;

function abrir() {
  if (!promessa) {
    promessa = new Promise((ok, erro) => {
      if (!('indexedDB' in globalThis)) return erro(new Error('sem IndexedDB'));
      const r = indexedDB.open(NOME, VERSAO);
      r.onupgradeneeded = () => {
        const db = r.result;
        if (!db.objectStoreNames.contains('pedais')) db.createObjectStore('pedais', { keyPath: 'id' });
        if (!db.objectStoreNames.contains('estado')) db.createObjectStore('estado');
      };
      r.onsuccess = () => ok(r.result);
      r.onerror = () => erro(r.error);
      r.onblocked = () => erro(new Error('banco bloqueado'));
    }).catch(e => { promessa = null; throw e; });
  }
  return promessa;
}

async function operar(loja, modo, fn) {
  const db = await abrir();
  return new Promise((ok, erro) => {
    const t = db.transaction(loja, modo);
    const req = fn(t.objectStore(loja));
    t.oncomplete = () => ok(req ? req.result : undefined);
    t.onerror = () => erro(t.error);
    t.onabort = () => erro(t.error || new Error('transação abortada'));
  });
}

// Reserva simples em localStorage
const LS = 'hodometro.reserva';
function lerReserva() { try { return JSON.parse(localStorage.getItem(LS)) || { pedais: {}, estado: {} }; } catch { return { pedais: {}, estado: {} }; } }
function gravarReserva(o) { try { localStorage.setItem(LS, JSON.stringify(o)); } catch { /* sem espaço */ } }

async function comReserva(fnIdb, fnLs) {
  try { return await fnIdb(); }
  catch { const o = lerReserva(); const r = fnLs(o); gravarReserva(o); return r; }
}

export const listarPedais = () => comReserva(
  () => operar('pedais', 'readonly', s => s.getAll()),
  o => Object.values(o.pedais));

export const salvarPedal = p => comReserva(
  () => operar('pedais', 'readwrite', s => s.put(p)),
  o => { o.pedais[p.id] = p; });

export const apagarPedal = id => comReserva(
  () => operar('pedais', 'readwrite', s => s.delete(id)),
  o => { delete o.pedais[id]; });

export const apagarTodos = () => comReserva(
  () => operar('pedais', 'readwrite', s => s.clear()),
  o => { o.pedais = {}; });

export const lerEstado = chave => comReserva(
  () => operar('estado', 'readonly', s => s.get(chave)),
  o => o.estado[chave]);

export const salvarEstado = (chave, valor) => comReserva(
  () => operar('estado', 'readwrite', s => s.put(valor, chave)),
  o => { o.estado[chave] = valor; });

export const apagarEstado = chave => comReserva(
  () => operar('estado', 'readwrite', s => s.delete(chave)),
  o => { delete o.estado[chave]; });

/** Pede ao navegador para não apagar os dados quando faltar espaço. */
export async function pedirPersistencia() {
  try { if (navigator.storage && navigator.storage.persist) return await navigator.storage.persist(); } catch { /* ignora */ }
  return false;
}
