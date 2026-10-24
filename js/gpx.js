// Exporta e importa pedais em GPX 1.1, o formato que Strava, Komoot e Garmin usam.
import { Rastreador } from './rastreador.js';

const esc = s => String(s).replace(/[<>&"']/g, c => ({ '<': '&lt;', '>': '&gt;', '&': '&amp;', '"': '&quot;', "'": '&apos;' }[c]));

export function gerarGPX(pedal, nome = 'Pedal') {
  const ini = pedal.inicio;
  const segmentos = [[]];
  const quebras = new Set((pedal.lacunas || []).map(l => l.i));
  (pedal.pontos || []).forEach(([lat, lon, t, alt], i) => {
    if (quebras.has(i) && segmentos[segmentos.length - 1].length) segmentos.push([]);
    const ele = alt != null ? `<ele>${alt}</ele>` : '';
    segmentos[segmentos.length - 1].push(`      <trkpt lat="${lat}" lon="${lon}">${ele}<time>${new Date(ini + t * 1000).toISOString()}</time></trkpt>`);
  });
  const trkseg = segmentos.filter(s => s.length).map(s => `    <trkseg>\n${s.join('\n')}\n    </trkseg>`).join('\n');
  return `<?xml version="1.0" encoding="UTF-8"?>
<gpx version="1.1" creator="Hodômetro" xmlns="http://www.topografix.com/GPX/1/1">
  <metadata><name>${esc(nome)}</name><time>${new Date(ini).toISOString()}</time></metadata>
  <trk>
    <name>${esc(nome)}</name>
    <type>cycling</type>
${trkseg}
  </trk>
</gpx>
`;
}

/** Lê os dados brutos de um arquivo GPX em formato string. */
export function lerGPX(xmlTexto) {
  const nomeMatch = xmlTexto.match(/<trk>[^]*?<name>(.*?)<\/name>/i) || xmlTexto.match(/<name>(.*?)<\/name>/i);
  const nome = nomeMatch ? nomeMatch[1].replace(/<!\[CDATA\[(.*?)\]\]>/g, '$1').trim() : 'Pedal importado';
  const pontos = [];
  const ptRegex = /<trkpt\s+[^>]*lat=["']([^"']+)["'][^>]*lon=["']([^"']+)["'][^>]*>([\s\S]*?)<\/trkpt>/gi;
  let m;
  while ((m = ptRegex.exec(xmlTexto)) !== null) {
    const lat = Number(m[1]), lon = Number(m[2]);
    if (!Number.isFinite(lat) || !Number.isFinite(lon)) continue;
    const corpo = m[3];
    const eleM = corpo.match(/<ele>([^<]+)<\/ele>/i);
    const timeM = corpo.match(/<time>([^<]+)<\/time>/i);
    const alt = eleM ? Number(eleM[1]) : null;
    const t = timeM ? new Date(timeM[1].trim()).getTime() : null;
    pontos.push({ lat, lon, alt: Number.isFinite(alt) ? alt : null, t });
  }
  return { nome, pontos };
}

/** Converte o conteúdo de um GPX em objeto de pedal completo e consistente com o motor. */
export function converterGPXEmPedal(xmlTexto, id) {
  const { nome, pontos } = lerGPX(xmlTexto);
  if (!pontos.length) throw new Error('Nenhum ponto de trajeto encontrado no arquivo GPX.');

  let tAtual = Date.now() - pontos.length * 1000;
  for (let i = 0; i < pontos.length; i++) {
    if (pontos[i].t == null || Number.isNaN(pontos[i].t)) {
      pontos[i].t = tAtual;
      tAtual += 1000;
    }
  }

  pontos.sort((a, b) => a.t - b.t);

  const t0 = pontos[0].t;
  const r = new Rastreador({ autoPausa: true }, t0);
  let ultimoT = 0;

  for (const p of pontos) {
    if (p.t <= ultimoT) continue;
    ultimoT = p.t;
    r.push({ lat: p.lat, lon: p.lon, alt: p.alt, t: p.t, acc: 5 });
  }

  const fimT = Math.max(t0 + 1000, ultimoT);
  const pedal = r.finalizar(fimT);
  pedal.id = id || ('gpx_' + Math.round(t0).toString(36) + Math.random().toString(36).slice(2, 6));
  pedal.nome = nome;
  pedal.importado = 'gpx';
  return pedal;
}
