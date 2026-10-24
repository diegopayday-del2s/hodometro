// Peças de interface usadas em várias telas: criar elementos, avisos,
// diálogos de confirmação e de texto, e o botão de segurar.
export const $ = s => document.querySelector(s);
export const $$ = s => [...document.querySelectorAll(s)];

export function h(tag, attrs, ...filhos) {
  const svg = ['svg', 'path', 'circle', 'rect', 'line', 'polyline', 'g', 'text', 'use'].includes(tag);
  const el = svg ? document.createElementNS('http://www.w3.org/2000/svg', tag) : document.createElement(tag);
  if (attrs) for (const k in attrs) {
    const v = attrs[k];
    if (v == null || v === false) continue;
    if (k === 'class') el.setAttribute('class', v);
    else if (k === 'text') el.textContent = v;
    else if (k.startsWith('on')) el.addEventListener(k.slice(2), v);
    else if (k === 'style') el.style.cssText = v;
    else el.setAttribute(k, v === true ? '' : v);
  }
  for (const f of filhos.flat()) if (f != null && f !== false) el.append(f.nodeType ? f : document.createTextNode(String(f)));
  return el;
}

/** Ícone do conjunto de símbolos do index.html. */
export const icone = (nome, cls) => h('svg', { class: cls || 'ic', 'aria-hidden': 'true' }, h('use', { href: '#i-' + nome }));

let toastT = 0;
export function aviso(msg, acaoTxt, acao, ms) {
  const t = $('#toast');
  t.replaceChildren(h('div', { class: 'toast-in' }, h('span', { text: msg }),
    acaoTxt ? h('button', { type: 'button', text: acaoTxt, onclick: () => { t.hidden = true; acao(); } }) : null));
  t.hidden = false;
  clearTimeout(toastT);
  toastT = setTimeout(() => { t.hidden = true; }, ms || (acaoTxt ? 8000 : 4000));
}

/** Diálogo de confirmação. Devolve true se a pessoa confirmou. */
export function confirmar(titulo, texto, sim = 'Excluir') {
  const d = $('#dlgConfirma');
  if (typeof d.showModal !== 'function') return Promise.resolve(window.confirm(`${titulo}\n\n${texto}`));
  $('#cfTitulo').textContent = titulo;
  $('#cfTexto').textContent = texto;
  $('#cfSim').textContent = sim;
  d.returnValue = '';
  return new Promise(ok => {
    d.addEventListener('close', () => ok(d.returnValue === 'sim'), { once: true });
    d.showModal();
  });
}

/** Pede um texto curto (nome de pedal ou de rota). Devolve o texto ou null. */
export function pedirTexto(titulo, valor = '', dica = '') {
  const d = $('#dlgTexto');
  if (typeof d.showModal !== 'function') { const r = window.prompt(titulo, valor); return Promise.resolve(r == null ? null : r.trim()); }
  $('#txTitulo').textContent = titulo;
  $('#txDica').textContent = dica;
  $('#txCampo').value = valor;
  d.returnValue = '';
  return new Promise(ok => {
    d.addEventListener('close', () => ok(d.returnValue === 'sim' ? $('#txCampo').value.trim() : null), { once: true });
    d.showModal();
    $('#txCampo').select();
  });
}

/**
 * Botão de segurar: só dispara depois de `ms` apertado, com a barra enchendo.
 * Soltar antes cancela. Protege o Finalizar de toque sem querer no bolso.
 */
export function segurarPara(btn, ms, acao, dica) {
  let timer = 0, disparou = false;
  const soltar = () => { if (!timer) return; clearTimeout(timer); timer = 0; btn.classList.remove('segurando'); };
  const apertar = ev => {
    if (timer) return;
    if (ev.pointerId != null) { try { btn.setPointerCapture(ev.pointerId); } catch { /* sem captura */ } }
    btn.classList.add('segurando');
    timer = setTimeout(() => { timer = 0; disparou = true; btn.classList.remove('segurando'); acao(); }, ms);
  };
  btn.addEventListener('pointerdown', apertar);
  for (const e of ['pointerup', 'pointercancel', 'lostpointercapture']) btn.addEventListener(e, soltar);
  btn.addEventListener('keydown', e => { if ((e.key === 'Enter' || e.key === ' ') && !e.repeat) { e.preventDefault(); apertar(e); } });
  btn.addEventListener('keyup', e => { if (e.key === 'Enter' || e.key === ' ') soltar(); });
  btn.addEventListener('contextmenu', e => e.preventDefault());
  btn.addEventListener('click', e => {
    e.preventDefault();
    if (disparou) { disparou = false; return; }
    if (!timer && dica) aviso(dica);
  });
}

/** Desenha quando o elemento aparece na tela (mapas do feed). */
const vistos = typeof IntersectionObserver === 'function'
  ? new IntersectionObserver(ents => { for (const e of ents) if (e.isIntersecting) { vistos.unobserve(e.target); e.target.__desenhar?.(); } }, { rootMargin: '200px' })
  : null;
export function quandoAparecer(el, fn) {
  if (!vistos) { requestAnimationFrame(fn); return; }
  el.__desenhar = fn;
  vistos.observe(el);
}
