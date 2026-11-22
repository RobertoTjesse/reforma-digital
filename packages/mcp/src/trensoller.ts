// Ferrocarril de Sóller: el tren de Palma a Sóller por Bunyola y el tranvía de Sóller al Port. Es una empresa privada sin GTFS: se leen las tablas de horarios de su
// web, que solo publica el horario de ahora y los próximos cierres, sin fechas de validez.
import { get, SourceError } from './comun';
import { addDays, iso, madrid, type Feed } from './gtfs';
import { days, fecha, slug, text, toGtfs, type Parada, type Tabla } from './horarios';

const URL = 'https://trendesoller.com/horarios.php';
/** Sin fechas en la web, el horario de ahora se da por bueno los próximos días. */
export const HORIZON_DAYS = 60;

const NAMES: Record<string, string> = {
  palma: 'Palma (estación de Plaça d’Espanya)',
  bunyola: 'Bunyola',
  soller: 'Sóller',
  'puerto-de-soller': 'Port de Sóller',
  'port-de-soller': 'Port de Sóller',
};
const parada = (label: string): Parada => {
  const id = slug(label);
  return {
    id: `soller-${id === 'puerto-de-soller' ? 'port-de-soller' : id}`,
    nombre: NAMES[id] ?? label,
  };
};

const MONTHS =
  'enero febrero marzo abril mayo junio julio agosto septiembre octubre noviembre diciembre'.split(
    ' ',
  );
const pad = (n: number | string) => String(n).padStart(2, '0');

/** Las fechas de un texto, «23 de noviembre de 2026» o «23/11/2026», como AAAAMMDD. */
export function dates(textIn: string): string[] {
  const out: { at: number; ymd: string }[] = [];
  for (const m of textIn.matchAll(/(\d{1,2})\/(\d{1,2})\/(\d{4})/g)) {
    out.push({ at: m.index, ymd: `${m[3]}${pad(m[2]!)}${pad(m[1]!)}` });
  }
  for (const m of textIn.matchAll(/(\d{1,2}) de ([a-záéíóú]+) de (\d{4})/gi)) {
    const month = MONTHS.indexOf(m[2]!.toLowerCase());
    if (month >= 0) out.push({ at: m.index, ymd: `${m[3]}${pad(month + 1)}${pad(m[1]!)}` });
  }
  return out.sort((a, b) => a.at - b.at).map((d) => d.ymd);
}

export type Cierre = { desde: string; hasta: string; texto: string };

/** «Próximo cierre del Tren: -Desde 23 de noviembre de 2026. -Hasta 01 de febrero de 2027» y el
 * del tranvía, con sus dos fechas (las dos incluidas). */
export function closures(page: string): { tren?: Cierre; tranvia?: Cierre } {
  const body = text(page);
  const out: { tren?: Cierre; tranvia?: Cierre } = {};
  for (const m of body.matchAll(
    /Pr[óo]ximo cierre del (Tren|Tranv[íi]a):?\s*(.*?)(?=Pr[óo]ximo cierre|Tren Tranv|Horarios Tren|$)/gi,
  )) {
    const which = /^tren$/i.test(m[1]!) ? 'tren' : 'tranvia';
    const texto = m[2]!.trim();
    const [desde, hasta] = dates(texto);
    if (!desde || !hasta) {
      throw new SourceError(
        `No se entienden las fechas del cierre del ${m[1]} en trendesoller.com.`,
      );
    }
    out[which] = { desde, hasta, texto };
  }
  return out;
}

/** Las cuatro tablas: tren Palma-Sóller y Sóller-Palma (paradas en columnas, varias horas por
 * celda) y tranvía Sóller-Port y Port-Sóller (solo la hora de salida). */
function parseTables(page: string) {
  const tables = [...page.matchAll(/<table\b[\s\S]*?<\/table>/gi)].map((t) =>
    [...t[0].matchAll(/<tr\b[\s\S]*?<\/tr>/gi)].map((tr) =>
      [...tr[0].matchAll(/<t[hd]\b[^>]*>([\s\S]*?)<\/t[hd]>/gi)].map((c) => text(c[1] ?? '')),
    ),
  );
  const tren: { paradas: Parada[]; salidas: string[][] }[] = [];
  const tranvia: { paradas: Parada[]; salidas: string[] }[] = [];
  for (const rows of tables) {
    const timeRow = rows.find((r) => r.some((c) => /\d{1,2}:\d\d/.test(c)));
    const names = rows.find((r) => r.some((c) => /palma/i.test(c)) && !r.some((c) => /\d/.test(c)));
    if (names && timeRow) {
      const stops = names.filter((c) => c !== '').map(parada);
      const columns = timeRow.filter((c) => c !== '').map((c) => c.split(/\s+/));
      const n = columns[0]?.length ?? 0;
      if (columns.length !== stops.length || columns.some((c) => c.length !== n)) {
        throw new SourceError('La tabla del tren de trendesoller.com no cuadra con sus paradas.');
      }
      tren.push({
        paradas: stops,
        salidas: Array.from({ length: n }, (_, j) => columns.map((c) => c[j]!)),
      });
      continue;
    }
    const title = rows[0]?.join(' ') ?? '';
    if (/puerto|port/i.test(title)) {
      const desdePuerto = /^\s*(puerto|port)/i.test(title);
      const stops = desdePuerto
        ? [parada('Puerto de Sóller'), parada('Sóller')]
        : [parada('Sóller'), parada('Puerto de Sóller')];
      const salidas = rows
        .slice(1)
        .flat()
        .filter((c) => /^\d{1,2}:\d\d\*?$/.test(c));
      tranvia.push({ paradas: stops, salidas });
    }
  }
  if (tren.length !== 2 || tranvia.length !== 2) {
    throw new SourceError(
      'trendesoller.com ya no publica las cuatro tablas de horarios de siempre.',
    );
  }
  return { tren, tranvia };
}

export function toTablas(page: string, today: string): Tabla[] {
  const { tren, tranvia } = parseTables(page);
  const cierres = closures(page);
  const end = addDays(iso(today), HORIZON_DAYS).replaceAll('-', '');
  const closed = (c?: Cierre) => (c ? [...days(c.desde, c.hasta)].map((d) => d.ymd) : []);
  const starred = tren.flatMap((t) =>
    t.salidas
      .filter((s) => s[0]?.endsWith('*'))
      .map((s) => `${s[0]?.replace('*', '')} desde ${t.paradas[0]?.nombre}`),
  );
  const notaTren = [
    cierres.tren &&
      `Cerrado del ${fecha(cierres.tren.desde)} al ${fecha(cierres.tren.hasta)}, los dos incluidos.`,
    starred.length > 0 &&
      `Hay que confirmar en taquilla las salidas de las ${starred.join(' y de las ')}.`,
    'La web solo publica el horario actual: tras un cierre o un cambio de temporada puede cambiar.',
  ]
    .filter(Boolean)
    .join(' ');
  const notaTranvia = [
    cierres.tranvia &&
      `Cerrado del ${fecha(cierres.tranvia.desde)} al ${fecha(cierres.tranvia.hasta)}, los dos incluidos${/bus/i.test(cierres.tranvia.texto) ? ', con un bus alternativo (su horario no se publica aquí)' : ''}.`,
    'Solo se publica la hora de salida.',
  ]
    .filter(Boolean)
    .join(' ');
  const trenLinea = {
    id: 'tren',
    numero: 'Tren',
    nombre: 'Palma - Bunyola - Sóller',
    nota: notaTren,
    tipo: 2,
  };
  const tranviaLinea = {
    id: 'tranvia',
    numero: 'Tranvía',
    nombre: 'Sóller - Port de Sóller',
    nota: notaTranvia,
    tipo: 0,
  };
  const base = { dias: '1111111', festivos: 'igual' as const, desde: today, hasta: end };
  return [
    ...tren.map((t) => ({
      ...base,
      linea: trenLinea,
      cabecera: t.paradas.at(-1)!.nombre,
      cierres: closed(cierres.tren),
      paradas: t.paradas,
      salidas: t.salidas.map((s) => s.map((h) => h.replace('*', ''))),
    })),
    ...tranvia.map((t) => ({
      ...base,
      linea: tranviaLinea,
      cabecera: t.paradas.at(-1)!.nombre,
      cierres: closed(cierres.tranvia),
      paradas: t.paradas,
      salidas: t.salidas.map((h) => [h.replace('*', ''), null]),
      llegadaSinHora: true,
    })),
  ];
}

export const SOLLER: Feed = {
  label: 'horario del Ferrocarril de Sóller',
  url: URL,
  load: async (fetchImpl) => {
    const page = await (await get(fetchImpl, URL, 'text/html')).text();
    return toGtfs(
      'Ferrocarril de Sóller',
      toTablas(page, madrid(Date.now()).date.replaceAll('-', '')),
    );
  },
  source:
    'Fuente: Ferrocarril de Sóller, S.A., horarios publicados en trendesoller.com. Confírmalos allí antes de ir: cambian con la temporada.',
};
