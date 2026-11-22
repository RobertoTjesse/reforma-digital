// Autocares Torres (bustorresmenorca.com): el bus del aeropuerto de Menorca, los urbanos de Maó y
// Ciutadella y las líneas a las calas de Ciutadella. Su web carga los horarios de dos fuentes: un
// GTFS en CSV (con festivos) y, para las temporadas que el GTFS ya no cubre, tablas de horarios que
// se editan a mano. Se juntan las dos como hace la web.
import { get, SourceError } from './comun';
import { addDays, iso, madrid, readCsv, type Feed, type Files, type Row } from './gtfs';
import { LECTIVOS, parseDays, slug, toGtfs, type Parada, type Tabla } from './horarios';

const SITE = 'https://www.bustorresmenorca.com/horarios';

/** Los CSV de su web; stops_other.csv completa stops.csv. stop_times.csv no existe (la web
 * responde con su portada): los tiempos están en stop_times_old.csv. */
const CSV = 'agency routes stops stops_other trips stop_times_old calendar calendar_dates'
  .split(' ')
  .map((n) => `${n}.csv`);

/** Un CSV de la web; si no existe, responde con su portada en HTML. */
export function siteCsv(name: string, body: string): Row[] {
  if (/^\s*</.test(body)) throw new SourceError(`bustorresmenorca.com no sirve ${name}.`);
  return readCsv(body);
}

/** Un horario de la web: paradas en filas, salidas en columnas; una «X» en la cabecera de una
 * columna es una salida sombreada, que solo circula de lunes a viernes no festivos. */
export type Generated = {
  line: string;
  schedule: {
    code: string;
    routeId: string;
    title: string;
    validFrom: string;
    validUntil: string;
    serviceDaysKey: string;
    serviceNote?: string | null;
    alertNote?: string | null;
  };
  header: string[];
  rows: string[][];
};

type ListEntry = { code: string; sourceToken: string; schedules: { code: string }[] };

const compact = (iso: string) => iso.replaceAll('-', '');

/** Un horario de la web como tablas: las salidas normales y, aparte, las sombreadas. */
function generatedToTablas(g: Generated, known: Map<string, Parada>): Tabla[] {
  const s = g.schedule;
  const notes = [s.serviceNote, s.alertNote].filter((n): n is string => !!n?.trim());
  // La nota «Circula de LUNES a SÁBADO» manda sobre serviceDaysKey, que a veces no la sigue.
  const said = notes.find((n) => /^circula\b/i.test(n.trim()));
  const parsed = said ? parseDays(said) : undefined;
  const dias = parsed?.dias ?? s.serviceDaysKey;
  if (!/^[01]{7}$/.test(dias)) throw new SourceError(`Días «${dias}» no válidos en ${s.code}.`);
  const festivos: Tabla['festivos'] = parsed
    ? parsed.festivos
      ? 'si'
      : 'no'
    : dias[6] === '1'
      ? 'igual'
      : 'no';
  const paradas = g.rows.map(([code = '', name = '']) => {
    const byCode = code !== '0' ? known.get(code) : undefined;
    const byName = known.get(`nombre:${slug(name)}`);
    return byCode ?? byName ?? { id: `torres-${slug(name)}`, nombre: name };
  });
  // La «X» es «sombreada» (de lunes a viernes no festivos) salvo que la nota diga otra cosa: en la
  // L15 marca la salida que «solo circula en días lectivos». Si lo dice la nota de días, todo.
  const school = (n: string) => /lectiv/i.test(n);
  const allSchool = said !== undefined && school(said);
  const shadedSchool = !notes.some((n) => /sombread/i.test(n)) && notes.some(school);
  const linea: Tabla['linea'] = {
    id: s.routeId,
    numero: g.line,
    nombre: s.title,
    ...(notes.length > 0 && {
      nota: [...notes, ...(notes.some(school) ? [`${LECTIVOS}.`] : [])].join(' '),
    }),
  };
  // Una línea circular (la L10 sale y vuelve a la estación de Maó) va con su nombre de cabecera.
  const last = paradas.at(-1);
  const base = {
    linea,
    cabecera: !last || last.id === paradas[0]?.id ? s.title : last.nombre,
    desde: compact(s.validFrom),
    hasta: compact(s.validUntil),
    paradas,
  };
  const columns = g.header.slice(2).map((flag, j) => ({
    shaded: flag.trim().toUpperCase() === 'X',
    times: g.rows.map((r) => {
      const t = (r[j + 2] ?? '').trim();
      return /^\d{1,2}:\d\d$/.test(t) ? t : null;
    }),
  }));
  const used = columns.filter((c) => c.times.some((t) => t !== null));
  const weekdays = [...dias].map((d, i) => (i < 5 ? d : '0')).join('');
  return [
    {
      ...base,
      dias,
      festivos,
      soloLectivos: allSchool,
      salidas: used.filter((c) => !c.shaded).map((c) => c.times),
    },
    {
      ...base,
      dias: weekdays,
      festivos: 'no' as const,
      soloLectivos: allSchool || shadedSchool,
      salidas: used.filter((c) => c.shaded).map((c) => c.times),
    },
  ].filter((t) => t.salidas.length > 0);
}

/** El GTFS en CSV de la web con los horarios a mano que cubren lo que él no: si el GTFS ya cubre
 * todas las fechas de un horario a mano (L19, L60), se queda el GTFS, que trae los festivos; si no,
 * el horario a mano sustituye a la línea desde su primer día. */
export function combine(
  /** Las filas de cada CSV de la web. */
  csv: Record<string, Row[]>,
  generated: Generated[],
  /** AAAAMMDD de hoy: lo que acabó antes no se sirve. */
  today: string,
): Files {
  const table = (name: string) => {
    const rows = csv[name];
    if (!rows) throw new SourceError(`Falta ${name} en bustorresmenorca.com.`);
    return rows;
  };
  const col = (r: Row, c: string) => r[c] ?? '';
  let trips = table('trips.csv');
  let calendar = table('calendar.csv');
  let calendarDates = table('calendar_dates.csv');
  const routesOf = new Map<string, Set<string>>();
  for (const t of trips) {
    const set = routesOf.get(col(t, 'service_id')) ?? new Set();
    routesOf.set(col(t, 'service_id'), set.add(col(t, 'route_id')));
  }

  // Paradas conocidas por código y por nombre, con «,» decimal en stops.csv.
  const known = new Map<string, Parada>();
  const stops: Row[] = [];
  for (const s of [...table('stops.csv'), ...table('stops_other.csv')]) {
    const id = col(s, 'stop_id');
    if (id === '' || known.has(id)) continue;
    const lat = Number(col(s, 'stop_lat').replace(',', '.'));
    const lon = Number(col(s, 'stop_lon').replace(',', '.'));
    const p: Parada = {
      id,
      nombre: col(s, 'stop_name'),
      codigo: col(s, 'stop_code'),
      ...(lat && lon && { lat, lon }),
    };
    known.set(id, p);
    if (!known.has(`nombre:${slug(p.nombre)}`)) known.set(`nombre:${slug(p.nombre)}`, p);
    stops.push({ ...s, stop_lat: p.lat?.toString() ?? '', stop_lon: p.lon?.toString() ?? '' });
  }

  const tablas: Tabla[] = [];
  for (const g of generated) {
    const from = compact(g.schedule.validFrom);
    const until = compact(g.schedule.validUntil);
    if (until < today) continue;
    const own = calendar.filter((c) => routesOf.get(col(c, 'service_id'))?.has(g.schedule.routeId));
    // Un solo servicio que abarque todas sus fechas: dos que solo tocan los extremos dejan un hueco.
    const covered = own.some((c) => col(c, 'start_date') <= from && col(c, 'end_date') >= until);
    if (covered) continue;
    tablas.push(...generatedToTablas(g, known));
    // Lo del GTFS de esa línea acaba el día antes, si el servicio es solo suyo.
    for (const c of own) {
      if (routesOf.get(col(c, 'service_id'))?.size !== 1 || col(c, 'end_date') < from) continue;
      c.end_date = compact(addDays(iso(from), -1));
      calendarDates = calendarDates.filter(
        (d) => d.service_id !== c.service_id || col(d, 'date') < from,
      );
    }
  }

  // Las temporadas pasadas se quedan en el GTFS de la web (las calas del verano, las líneas que ya
  // tienen horario a mano): sin ellas, find_routes solo da lo que circula de hoy en adelante.
  const live = new Set([
    ...calendar.filter((c) => col(c, 'end_date') >= today).map((c) => col(c, 'service_id')),
    ...calendarDates
      .filter((d) => d.exception_type === '1' && col(d, 'date') >= today)
      .map((d) => col(d, 'service_id')),
  ]);
  trips = trips.filter((t) => live.has(col(t, 'service_id')));
  calendar = calendar.filter((c) => live.has(col(c, 'service_id')));
  calendarDates = calendarDates.filter((d) => live.has(col(d, 'service_id')));
  const running = new Set(trips.map((t) => t.route_id));
  // stop_times_old.csv aún trae tiempos de viajes que trips.csv ya no tiene (H6501…): fuera.
  const tripIds = new Set(trips.map((t) => t.trip_id));
  const stopTimes = table('stop_times_old.csv').filter((r) => tripIds.has(r.trip_id));
  const usedStops = new Set(stopTimes.map((r) => r.stop_id));
  const site: Files = new Map([
    ['agency.txt', table('agency.csv')],
    ['routes.txt', table('routes.csv').filter((r) => running.has(r.route_id))],
    ['stops.txt', stops.filter((s) => usedStops.has(s.stop_id))],
    ['trips.txt', trips],
    ['stop_times.txt', stopTimes],
    ['calendar.txt', calendar],
    ['calendar_dates.txt', calendarDates],
  ]);
  // Los ids de toGtfs (s0, 0-0) no chocan con los del GTFS de la web (H1001, 60a01…).
  const own = toGtfs('Autocares Torres', tablas);
  // Las fechas del feed salen de los dos calendarios, no solo de los horarios a mano.
  own.delete('feed_info.txt');
  for (const [name, rows] of own) site.set(name, [...(site.get(name) ?? []), ...rows]);
  return site;
}

export const TORRES: Feed = {
  label: 'horario de Autocares Torres',
  url: `${SITE}/`,
  load: async (fetchImpl) => {
    const json = async <T>(url: string) => {
      const body = (await (await get(fetchImpl, url)).json()) as T & { ok?: boolean };
      if (body.ok === false) throw new SourceError('bustorresmenorca.com no devolvió el horario.');
      return body;
    };
    const [csv, list] = await Promise.all([
      Promise.all(
        CSV.map(async (n) => {
          const body = await (await get(fetchImpl, `${SITE}/csv/${n}`, '*/*')).text();
          return [n, siteCsv(n, body)] as const;
        }),
      ),
      json<{ lines: ListEntry[] }>(`${SITE}/generated.php?action=list`),
    ]);
    const wanted = list.lines.flatMap((l) =>
      l.schedules
        // La web lista la L64 con el horario de la L65 («65a-…»): solo los que son de su línea.
        .filter((s) => s.code.startsWith(l.code.replace(/^L/i, '')))
        .map((s) => ({ token: l.sourceToken, code: s.code })),
    );
    const generated = await Promise.all(
      wanted.map((w) =>
        json<Generated>(
          `${SITE}/generated.php?action=schedule&line=${encodeURIComponent(w.token)}&schedule=${encodeURIComponent(w.code)}`,
        ),
      ),
    );
    return combine(Object.fromEntries(csv), generated, compact(madrid(Date.now()).date));
  },
  source:
    'Fuente: Torres Allès Autocares, S.L. (Bus Torres), horarios publicados en bustorresmenorca.com. Pueden cambiar sin aviso: confírmalos en su web.',
};
