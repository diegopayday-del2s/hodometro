// Exporta um pedal em GPX 1.1, o formato que Strava, Komoot e Garmin importam.

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
