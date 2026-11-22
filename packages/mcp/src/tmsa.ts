// TMSA (Transportes Menorca): los autobuses interurbanos de Menorca. No publica GTFS: se leen
// las tablas de horarios de tmsa.es.
import { get, SourceError, type Fetch } from './comun';
import type { Feed } from './gtfs';
import { LECTIVOS, parseDays, slug, text, toGtfs, type Tabla } from './horarios';

const BASE = 'https://www.tmsa.es';
const LINES = `${BASE}/es/transporte-regular`;

type Linea = { codigo: string; nombre: string };

/** Las líneas operativas: las que enlazan a su horario actual («/es/horarios/601/VISIBLE»). */
export function parseLines(html: string): Linea[] {
  const visible = new Set([...html.matchAll(/\/es\/horarios\/(\d+)\/VISIBLE/g)].map((m) => m[1]));
  const lines = new Map<string, string>();
  for (const m of html.matchAll(
    /<a\b[^>]*href="linea\/(\d+)"[^>]*class="linea"[^>]*>([\s\S]*?)<\/a>/g,
  )) {
    const [, codigo = '', nombre = ''] = m;
    if (visible.has(codigo) && !lines.has(codigo)) lines.set(codigo, text(nombre));
  }
  if (lines.size === 0) throw new SourceError('tmsa.es no lista ninguna línea con horario.');
  return [...lines].map(([codigo, nombre]) => ({ codigo, nombre }));
}

const ymd = (dmy: string) => dmy.split('-').reverse().join('');

type Bloque = {
  dias: string;
  sentido: string;
  desde: string;
  hasta: string;
  paradas: string[];
  /** Una fila por parada, una columna por salida. */
  filas: string[][];
};

/** Los horarios de una línea: un bloque por días y sentido, con las paradas en filas. */
export function parseTimetable(html: string): Bloque[] {
  return html
    .split(/class="[^"]*encabezado-horario-descripcion[^"]*"/)
    .slice(1)
    .map((block) => {
      const [head = '', body = ''] = block.split(/class="[^"]*horario-tabla-scroll[^"]*"/);
      const cabecera = text(`<i ${head}`);
      const m =
        /^(.*?)\s*Sentido:\s*(.*?)\s*Válido:\s*(\d\d-\d\d-\d{4})\s*hasta\s*(\d\d-\d\d-\d{4})/.exec(
          cabecera,
        );
      if (!m) throw new SourceError(`Cabecera de horario de TMSA no reconocida: «${cabecera}».`);
      const [, dias = '', sentido = '', desde = '', hasta = ''] = m;
      const paradas = [...body.matchAll(/horario-parada-nombre[^>]*>([\s\S]*?)<\/span>/g)].map(
        (p) => text(p[1] ?? ''),
      );
      const filas = body
        .split(/class="[^"]*horario-fila-horas[^"]*"/)
        .slice(1)
        .map((row) =>
          [...row.matchAll(/class="[^"]*horario-hora[^"]*"[^>]*>([\s\S]*?)<\/div>/g)].map((c) =>
            text(c[1] ?? ''),
          ),
        );
      return { dias, sentido, desde: ymd(desde), hasta: ymd(hasta), paradas, filas };
    });
}

const SCHOOL = /lectiv/i;

/** Los bloques de una línea como horarios: las filas de paradas pasan a ser salidas. Lo que solo
 * circula en días lectivos lo dice un bloque entero en sus días, o una salida con un asterisco. */
export function toTablas(linea: Linea, bloques: Bloque[]): Tabla[] {
  const columns = bloques.map((b) =>
    Array.from({ length: Math.max(0, ...b.filas.map((f) => f.length)) }, (_, j) =>
      b.filas.map((f) => (/\d/.test(f[j] ?? '') ? (f[j] ?? '') : null)),
    ),
  );
  const starred = (s: (string | null)[]) => s.some((h) => h?.includes('*'));
  const clean = (s: (string | null)[]) => s.map((h) => h?.replace('*', '') ?? null);
  const lectivos = [
    ...new Set(
      bloques.filter((b) => SCHOOL.test(b.dias)).map((b) => `${b.dias}, sentido ${b.sentido}`),
    ),
    ...bloques.flatMap((b, i) =>
      (columns[i] ?? [])
        .filter(starred)
        .map(
          (s) =>
            `salida de las ${clean(s).find((h) => h !== null)} (${b.dias}, sentido ${b.sentido})`,
        ),
    ),
  ];
  const info: Tabla['linea'] = {
    id: linea.codigo,
    // TMSA numera por dentro 601 lo que en las paradas y en el CIME es la L01.
    numero: `L${linea.codigo.slice(-2)}`,
    nombre: linea.nombre,
    ...(lectivos.length > 0 && { nota: `${LECTIVOS}: ${lectivos.join('; ')}.` }),
  };
  return bloques.flatMap((b, i) => {
    if (/sin servicio/i.test(b.dias)) return [];
    const days = parseDays(b.dias);
    if (!days) throw new SourceError(`Días de TMSA no reconocidos: «${b.dias}».`);
    if (b.filas.length !== b.paradas.length || b.paradas.length < 2) {
      throw new SourceError(`El horario de la ${info.numero} no tiene una fila por parada.`);
    }
    const base = {
      linea: info,
      cabecera: b.sentido,
      dias: days.dias,
      festivos: days.festivos ? ('si' as const) : ('no' as const),
      desde: b.desde,
      hasta: b.hasta,
      paradas: b.paradas.map((nombre) => ({ id: `tmsa-${slug(nombre)}`, nombre })),
    };
    const all = columns[i] ?? [];
    return [
      {
        ...base,
        soloLectivos: SCHOOL.test(b.dias),
        salidas: all.filter((s) => !starred(s)).map(clean),
      },
      { ...base, soloLectivos: true, salidas: all.filter(starred).map(clean) },
    ].filter((t) => t.salidas.length > 0);
  });
}

const html = async (fetchImpl: Fetch, url: string) =>
  (await get(fetchImpl, url, 'text/html')).text();

export const TMSA: Feed = {
  label: 'horario de TMSA',
  url: LINES,
  load: async (fetchImpl) => {
    const lines = parseLines(await html(fetchImpl, LINES));
    const tablas = await Promise.all(
      lines.map(async (l) =>
        toTablas(
          l,
          parseTimetable(await html(fetchImpl, `${BASE}/es/horarios/${l.codigo}/VISIBLE`)),
        ),
      ),
    );
    return toGtfs('Transportes Menorca (TMSA)', tablas.flat());
  },
  source:
    'Fuente: Transportes Menorca, S.A. (TMSA), horarios publicados en tmsa.es. Pueden cambiar sin aviso: confírmalos en tmsa.es.',
};
