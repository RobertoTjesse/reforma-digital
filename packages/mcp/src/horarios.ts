// Operadores sin GTFS (el Tren de Sóller): publican sus horarios como tablas de paradas por
// salidas. Aquí se convierten en las tablas de un GTFS para servirlos con las mismas herramientas
// que los de TIB o la EMT.
import { fold, SourceError } from './comun';
import type { Files, Row } from './gtfs';

export const fecha = (ymd: string) => `${ymd.slice(6, 8)}/${ymd.slice(4, 6)}/${ymd.slice(0, 4)}`;

export type Parada = { id: string; nombre: string; codigo?: string; lat?: number; lon?: number };

/** Un horario publicado: las salidas de una línea en un sentido, todos los días entre dos fechas. */
export type Tabla = {
  linea: { id: string; numero: string; nombre: string; nota?: string; tipo?: number };
  cabecera: string;
  /** AAAAMMDD, los dos incluidos. */
  desde: string;
  hasta: string;
  /** Días sin servicio (cierres), AAAAMMDD. */
  cierres?: string[];
  paradas: Parada[];
  /** Una fila por salida con la hora en cada parada (H:MM o HH:MM; 24:10 es la madrugada
   * siguiente) o null si no para. */
  salidas: (string | null)[][];
  /** La última parada no tiene hora publicada (el tranvía de Sóller solo da la de salida). */
  llegadaSinHora?: boolean;
};

/** AAAAMMDD de los días entre dos fechas, las dos incluidas. */
export function* days(desde: string, hasta: string) {
  const d = new Date(Date.UTC(+desde.slice(0, 4), +desde.slice(4, 6) - 1, +desde.slice(6, 8)));
  for (let i = 0; i < 800; i++) {
    const ymd = d.toISOString().slice(0, 10).replaceAll('-', '');
    if (ymd > hasta) return;
    yield ymd;
    d.setUTCDate(d.getUTCDate() + 1);
  }
}

function time(text: string, label: string): number {
  const m = /^(\d{1,2})[:.](\d\d)$/.exec(text.trim());
  if (!m) throw new SourceError(`Hora «${text}» no válida en el horario de ${label}.`);
  return Number(m[1]) * 3600 + Number(m[2]) * 60;
}
const hms = (s: number) =>
  [Math.floor(s / 3600), Math.floor(s / 60) % 60, s % 60]
    .map((n) => String(n).padStart(2, '0'))
    .join(':');

/** Las tablas de un GTFS con las salidas de un operador. Cada día con servicio va en
 * calendar_dates.txt: así los cierres son solo días que no están. */
export function toGtfs(agencia: string, tablas: Tabla[]): Files {
  const routes = new Map<string, Row>();
  const stops = new Map<string, Row>();
  const calendarDates: Row[] = [];
  const trips: Row[] = [];
  const stopTimes: Row[] = [];
  let [desde, end] = ['99999999', ''];

  tablas.forEach((t, i) => {
    const { id, numero, nombre, nota = '', tipo = 3 } = t.linea;
    routes.set(id, {
      route_id: id,
      agency_id: 'A',
      route_short_name: numero,
      route_long_name: nombre,
      route_desc: nota,
      route_type: String(tipo),
    });
    for (const p of t.paradas) {
      stops.set(p.id, {
        stop_id: p.id,
        stop_code: p.codigo ?? '',
        stop_name: p.nombre,
        stop_lat: p.lat?.toString() ?? '',
        stop_lon: p.lon?.toString() ?? '',
      });
    }
    const service = `s${i}`;
    const closed = new Set(t.cierres);
    if (t.desde < desde) desde = t.desde;
    if (t.hasta > end) end = t.hasta;
    for (const ymd of days(t.desde, t.hasta)) {
      if (!closed.has(ymd)) {
        calendarDates.push({ service_id: service, date: ymd, exception_type: '1' });
      }
    }
    t.salidas.forEach((salida, j) => {
      if (salida.length !== t.paradas.length) {
        throw new SourceError(`Una salida de la línea ${numero} no cuadra con sus paradas.`);
      }
      const trip = `${i}-${j}`;
      trips.push({ route_id: id, service_id: service, trip_id: trip, trip_headsign: t.cabecera });
      // Una hora menor que la anterior del mismo viaje es de la madrugada siguiente.
      let last = -1;
      salida.forEach((hora, k) => {
        const call = { trip_id: trip, stop_id: t.paradas[k]!.id, stop_sequence: String(k + 1) };
        if (hora === null) {
          const final = k === salida.length - 1;
          if (final && t.llegadaSinHora) stopTimes.push({ ...call, departure_time: '' });
          return;
        }
        let s = time(hora, numero);
        while (s < last) s += 24 * 3600;
        last = s;
        stopTimes.push({ ...call, departure_time: hms(s) });
      });
    });
  });

  return new Map([
    ['agency.txt', [{ agency_id: 'A', agency_name: agencia }]],
    ['routes.txt', [...routes.values()]],
    ['stops.txt', [...stops.values()]],
    ['calendar_dates.txt', calendarDates],
    ['trips.txt', trips],
    ['stop_times.txt', stopTimes],
    // Las fechas de las tablas, aunque los primeros o los últimos días estén cerrados.
    ['feed_info.txt', end === '' ? [] : [{ feed_start_date: desde, feed_end_date: end }]],
  ]);
}

/** Id de parada a partir del nombre, para los operadores que no dan códigos. */
export const slug = (text: string) =>
  fold(text.replaceAll('’', "'"))
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-|-$/g, '');

const ENTITIES: Record<string, string> = {
  amp: '&',
  lt: '<',
  gt: '>',
  quot: '"',
  apos: "'",
  nbsp: ' ',
};

/** El texto de un trozo de HTML, sin etiquetas, con las entidades resueltas y los espacios juntos. */
export const text = (html: string) =>
  html
    .replace(/<(script|style)\b[\s\S]*?<\/\1>/gi, ' ')
    .replace(/<[^>]*>/g, ' ')
    .replace(/&#(\d+);/g, (_, n: string) => String.fromCodePoint(Number(n)))
    .replace(/&#x([0-9a-f]+);/gi, (_, n: string) => String.fromCodePoint(parseInt(n, 16)))
    .replace(/&([a-z]+);/gi, (m, name: string) => ENTITIES[name.toLowerCase()] ?? m)
    .replace(/\s+/g, ' ')
    .trim();
