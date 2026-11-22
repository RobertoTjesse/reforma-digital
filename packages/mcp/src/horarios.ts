// Operadores sin GTFS (el Tren de Sóller, TMSA, Bus Torres): publican sus horarios
// como tablas de paradas por salidas. Aquí se convierten en las tablas de un GTFS para servirlos
// con las mismas herramientas que los de TIB o la EMT.
import { fold, SourceError } from './comun';
import type { Files, Row } from './gtfs';

/** AAAAMMDD separados por espacios a una lista. */
const ymds = (text: string) => text.trim().split(/\s+/);

/** Festivos de ámbito general de las Illes Balears: 2026 (BOIB núm. 129, de 27/09/2025, y sus
 * modificaciones) y 2027 (Consell de Govern de 13/03/2026). Los locales de cada municipio no se
 * tienen en cuenta: cambian de un pueblo a otro. Hay que añadir cada año cuando se publique. */
const FESTIVOS_BALEARES = ymds(`
  20260101 20260106 20260302 20260402 20260403 20260406 20260501 20260815 20261012 20261208
  20261225 20261226 20270101 20270106 20270301 20270325 20270326 20270329 20270501 20271012
  20271101 20271206 20271208 20271225`);

/** Calendario escolar de las Illes Balears (Conselleria d'Educació i Universitats, BOIB núm. 41,
 * de 31/03/2026), el mismo en todas las islas: clases de lunes a viernes entre el inicio y el final
 * del curso, salvo los festivos y las vacaciones (Nadal, la festa escolar unificada y Pasqua). Los
 * días de libre disposición de cada centro no se publican juntos y no se tienen en cuenta. Hay que
 * añadir cada curso cuando se publique. */
const CURSOS = [
  {
    inicio: '20260910',
    fin: '20270618',
    vacaciones: [
      ['20261223', '20270106'],
      ['20270226', '20270226'],
      ['20270325', '20270404'],
    ],
  },
];

/** Si un día de entre semana (AAAAMMDD) hay clase. Fuera de un curso publicado, no. */
export function lectivo(ymd: string, festivos: Set<string>): boolean {
  const curso = CURSOS.find((c) => ymd >= c.inicio && ymd <= c.fin);
  return (
    curso !== undefined &&
    !festivos.has(ymd) &&
    !curso.vacaciones.some(([desde = '', hasta = '']) => ymd >= desde && ymd <= hasta)
  );
}

export const fecha = (ymd: string) => `${ymd.slice(6, 8)}/${ymd.slice(4, 6)}/${ymd.slice(0, 4)}`;

const FIN_CURSO = CURSOS.at(-1)?.fin ?? '';

/** Lo que se dice de los servicios de días lectivos en la nota de cada línea. */
export const LECTIVOS = `Solo en días lectivos (calendario escolar de las Illes Balears, publicado hasta el ${fecha(FIN_CURSO)}; sin los días de libre disposición de cada centro)`;

export type Parada = { id: string; nombre: string; codigo?: string; lat?: number; lon?: number };

/** Un horario publicado: las salidas de una línea en un sentido, unos días y unas fechas. */
export type Tabla = {
  linea: { id: string; numero: string; nombre: string; nota?: string; tipo?: number };
  cabecera: string;
  /** De lunes a domingo, «1111100» para laborables; sin él, todos los días (el Tren de Sóller). */
  dias?: string;
  /** Los festivos que caen en esas fechas: «no» circula, «si» circula aunque no sea uno de sus
   * días (los horarios de domingos y festivos) o «igual» que cualquier otro día, sin indicarlo. */
  festivos?: 'no' | 'si' | 'igual';
  /** AAAAMMDD, los dos incluidos. */
  desde: string;
  hasta: string;
  /** Días sin servicio (cierres), AAAAMMDD. */
  cierres?: string[];
  /** Solo los días lectivos del calendario escolar (los buses de los institutos). */
  soloLectivos?: boolean;
  paradas: Parada[];
  /** Una fila por salida con la hora en cada parada (H:MM o HH:MM; 24:10 es la madrugada
   * siguiente) o null si no para. */
  salidas: (string | null)[][];
  /** La última parada no tiene hora publicada (el tranvía de Sóller solo da la de salida). */
  llegadaSinHora?: boolean;
};

/** AAAAMMDD de los días entre dos fechas, las dos incluidas, con su día de la semana (0, lunes). */
export function* days(desde: string, hasta: string) {
  const d = new Date(Date.UTC(+desde.slice(0, 4), +desde.slice(4, 6) - 1, +desde.slice(6, 8)));
  const ymd = () => d.toISOString().slice(0, 10).replaceAll('-', '');
  for (let day = ymd(); day <= hasta; day = ymd()) {
    yield { ymd: day, weekday: (d.getUTCDay() + 6) % 7 };
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
 * calendar_dates.txt: así los festivos, los cierres y el calendario escolar son solo un día más. */
export function toGtfs(agencia: string, tablas: Tabla[], festivos = FESTIVOS_BALEARES): Files {
  const holidays = new Set(festivos);
  const routes = new Map<string, Row>();
  const stops = new Map<string, Row>();
  const calendarDates: Row[] = [];
  const trips: Row[] = [];
  const stopTimes: Row[] = [];
  let [desde, end] = ['99999999', ''];

  tablas.forEach((t, i) => {
    const { dias = '1111111', festivos: enFestivo = 'igual' } = t;
    if (!/^[01]{7}$/.test(dias)) throw new SourceError(`Días «${dias}» no válidos.`);
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
    // Más allá del último año de festivos o del último curso publicados no se sabe qué días hay
    // servicio: la tabla acaba ahí y el feed lo dice, en vez de dar días de más o de menos.
    const known = [
      `${(festivos.at(-1) ?? '').slice(0, 4)}1231`,
      t.soloLectivos ? FIN_CURSO : t.hasta,
    ];
    const hasta = [t.hasta, ...known].sort()[0] ?? t.hasta;
    if (t.desde < desde) desde = t.desde;
    if (hasta > end) end = hasta;
    for (const { ymd, weekday } of days(t.desde, hasta)) {
      const holiday = holidays.has(ymd);
      const runs =
        (holiday && enFestivo === 'si') ||
        (dias[weekday] === '1' && !(holiday && enFestivo === 'no'));
      if (runs && !closed.has(ymd) && (!t.soloLectivos || lectivo(ymd, holidays))) {
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

const DAY_NAMES = ['lunes', 'martes', 'miercoles', 'jueves', 'viernes', 'sabado', 'domingo'];

/** Los días de un rótulo como «De Lunes a Viernes», «Sábados, Domingos y Festivos» o «Lunes,
 * Martes y Jueves» («1111100», …) y si incluye los festivos. undefined si no se entiende. */
export function parseDays(label: string): { dias: string; festivos: boolean } | undefined {
  const t = fold(label);
  if (/todos los dias|diario/.test(t)) return { dias: '1111111', festivos: true };
  const found = [...t.matchAll(/\b(lunes|martes|miercoles|jueves|viernes|sabado|domingo)s?\b/g)];
  // «Festivos» a secas: solo los festivos.
  if (found.length === 0)
    return /^festivos?$/.test(t) ? { dias: '0000000', festivos: true } : undefined;
  const on = Array<boolean>(7).fill(false);
  for (let i = 0; i < found.length; i++) {
    const day = DAY_NAMES.indexOf(found[i]![1]!);
    const next = found[i + 1];
    // «de lunes a viernes»: un rango entre los dos.
    const between = next ? t.slice(found[i]!.index + found[i]![0].length, next.index) : '';
    if (next && /^\s+(a|al)\s+$/.test(between)) {
      const end = DAY_NAMES.indexOf(next[1]!);
      for (let d = day; d <= end; d++) on[d] = true;
      i++;
    } else on[day] = true;
  }
  // «Martes y viernes no festivos», «ni los festivos»: los nombra para excluirlos.
  const festivos = /\bfestiv/.test(t) && !/\b(no|ni|excepto|salvo)\s+(los\s+)?festiv/.test(t);
  return { dias: on.map((x) => (x ? '1' : '0')).join(''), festivos };
}
