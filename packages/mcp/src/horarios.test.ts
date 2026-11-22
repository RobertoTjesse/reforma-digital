// @vitest-environment node
// Operadores sin GTFS, sin red: trozos de HTML, CSV y JSON con la forma de los de sus webs (TMSA,
// Bus Torres, el Tren de Sóller) y el horario copiado de Bus Formentera.
import { describe, expect, it } from 'vitest';
import { FORMENTERA, TABLAS } from './busformentera';
import { combine, siteCsv, type Generated } from './bustorres';
import { buildIndex, findRoutes, loadIndex, routeStops, stopTimes } from './gtfs';
import { lectivo, parseDays, toGtfs } from './horarios';
import { parseLines, parseTimetable, toTablas as tmsaTablas } from './tmsa';
import { closures, dates, toTablas as sollerTablas } from './trensoller';

const at = (h: number) => h * 3600;
const times = (r: ReturnType<typeof stopTimes>) => r.salidas.map((s) => `${s.hora} ${s.linea}`);

describe('horarios', () => {
  it('reads the day labels operators print', () => {
    expect(parseDays('De Lunes a Viernes')).toEqual({ dias: '1111100', festivos: false });
    expect(parseDays('Sábados, Domingos y Festivos')).toEqual({ dias: '0000011', festivos: true });
    expect(parseDays('Lunes, Martes y Jueves (SOLO DÍAS LECTIVOS)')?.dias).toBe('1101000');
    expect(parseDays('De Lunes a Jueves')?.dias).toBe('1111000');
    expect(parseDays('Circula de LUNES a SÁBADO.')?.dias).toBe('1111110');
    expect(parseDays('Circula los MARTES y VIERNES no festivos')).toEqual({
      dias: '0100100',
      festivos: false,
    });
    expect(parseDays('Temporada alta')).toBeUndefined();
  });

  it('knows the Balearic school calendar 2026-2027', () => {
    const none = new Set<string>();
    expect(lectivo('20260909', none)).toBe(false);
    expect(lectivo('20260910', none)).toBe(true);
    expect(lectivo('20261223', none)).toBe(false);
    expect(lectivo('20270107', none)).toBe(true);
    expect(lectivo('20270226', none)).toBe(false);
    expect(lectivo('20270404', none)).toBe(false);
    expect(lectivo('20270405', none)).toBe(true);
    expect(lectivo('20270618', none)).toBe(true);
    expect(lectivo('20270621', none)).toBe(false);
    expect(lectivo('20261208', new Set(['20261208']))).toBe(false);
  });

  const linea = { id: 'X', numero: 'X1', nombre: 'Prueba' };
  const paradas = [
    { id: 'a', nombre: 'A' },
    { id: 'b', nombre: 'B' },
  ];
  const base = { linea, cabecera: 'B', desde: '20261201', hasta: '20261231', paradas };
  const files = toGtfs('Operador', [
    { ...base, dias: '1111100', festivos: 'no', salidas: [['08:00', '08:30']] },
    { ...base, dias: '0000001', festivos: 'si', salidas: [['10:00', '10:30']] },
    {
      ...base,
      dias: '1111111',
      festivos: 'igual',
      cierres: ['20261224'],
      salidas: [['23:50', '0:20']],
    },
  ]);
  const index = buildIndex(files, 'horario de prueba');

  it('swaps a weekday holiday for the Sunday timetable and honours closures', () => {
    // 8 de diciembre de 2026, martes y festivo; el 9, un miércoles cualquiera.
    expect(times(stopTimes(index, 'a', { date: '2026-12-08', limit: 9 }))).toEqual([
      '10:00 X1',
      '23:50 X1',
    ]);
    expect(times(stopTimes(index, 'a', { date: '2026-12-09', limit: 9 }))).toEqual([
      '08:00 X1',
      '23:50 X1',
    ]);
    expect(times(stopTimes(index, 'a', { date: '2026-12-24', limit: 9 }))).toEqual(['08:00 X1']);
  });

  it('carries a trip past midnight instead of going back in time', () => {
    const b = stopTimes(index, 'b', { date: '2026-12-10', limit: 9 });
    expect(b.salidas).toEqual([]);
    expect(routeStops(index, 'X1').viajes).toBe(3);
    expect(files.get('stop_times.txt')?.some((r) => r.departure_time === '24:20:00')).toBe(true);
  });
});

describe('TMSA', () => {
  const block = (dias: string, sentido: string, paradas: string[], filas: string[][]) => `
    <div class="row p-0 encabezado-horario mb-2 sm-radius">
      <div class="col-12 col-lg-4 encabezado-horario-descripcion"><span>${dias}</span></div>
      <div class="col-12 col-lg-4"><span>Sentido: ${sentido}</span></div>
      <div class="col-12 col-lg-4"><span>Válido: 01-11-2026 hasta 30-04-2027<span></div>
    </div>
    <div class="row mb-2 horario-tabla-scroll">
      <div class="horario-columna-paradas">${paradas
        .map((p) => `<div class="row"><span class="horario-parada-nombre">${p}</span></div>`)
        .join('')}</div>
      <div class="horario-columna-horas">${filas
        .map(
          (f) =>
            `<div class="row horario-fila-horas">${f
              .map((h) => `<div class="float-left horario-hora "><span>${h}</span></div>`)
              .join('')}</div>`,
        )
        .join('')}</div>
    </div>`;
  const page = [
    block(
      'De Lunes a Viernes',
      'Sant Lluís',
      ['Estació d&#039;autobusos de Maó', 'Sant Lluís'],
      [
        ['07:45', '14:05*'],
        ['08:00', '14:20*'],
      ],
    ),
    block(
      'Sábados',
      'Sant Lluís',
      ['Estació d&#039;autobusos de Maó', 'Hipòdrom (a.)', 'Sant Lluís'],
      [['09:00'], ['-'], ['09:20']],
    ),
    block('Domingos y festivos: sin servicio', 'Sant Lluís', [], []),
  ].join('');
  const linea = { codigo: '603', nombre: 'Maó-Sant Lluís' };
  const index = buildIndex(toGtfs('TMSA', tmsaTablas(linea, parseTimetable(page))), 'TMSA');

  it('lists only the lines with a current timetable, by name', () => {
    const html = `<a href="linea/601" class="linea" style="color: #24A08C;">Maó-Ciutadella</a>
      <a href="/es/horarios/601/VISIBLE">Actuales</a>
      <a href="linea/622" class="linea">Maó-Es Canutells</a>`;
    expect(parseLines(html)).toEqual([{ codigo: '601', nombre: 'Maó-Ciutadella' }]);
  });

  it('turns stop rows into departures and drops a stop the bus skips', () => {
    expect(findRoutes(index, '3', 5).lineas[0]).toMatchObject({ id: '603', linea: 'L03' });
    const sat = stopTimes(index, "Estació d'autobusos de Maó", { date: '2026-11-28', limit: 9 });
    expect(times(sat)).toEqual(['09:00 L03']);
    expect(stopTimes(index, 'Hipòdrom (a.)', { date: '2026-11-28', limit: 9 }).total).toBe(0);
    expect(stopTimes(index, 'Sant Lluís', { date: '2026-11-28', limit: 9 }).total).toBe(0);
    expect(stopTimes(index, 'tmsa-sant-lluis', { date: '2026-11-29', limit: 9 }).total).toBe(0);
  });

  it('runs school-day departures only on school days, and says so', () => {
    const at = (date: string) =>
      stopTimes(index, 'tmsa-estacio-d-autobusos-de-mao', { date, limit: 9 });
    const mon = at('2026-11-23');
    expect(times(mon)).toEqual(['07:45 L03', '14:05 L03']);
    expect(mon.avisos?.[0]).toContain(
      'salida de las 14:05 (De Lunes a Viernes, sentido Sant Lluís)',
    );
    // Navidad, la festa escolar unificada y Pascua: el bus normal sí, el escolar no.
    expect(times(at('2026-12-28'))).toEqual(['07:45 L03']);
    expect(times(at('2027-02-26'))).toEqual(['07:45 L03']);
    expect(times(at('2027-03-31'))).toEqual(['07:45 L03']);
  });

  it('runs a whole «solo días lectivos» timetable only in term time', () => {
    const school = block(
      'De Lunes a Viernes (SOLO DÍAS LECTIVOS)',
      'Ferreries',
      ['Es Migjorn Gran', 'Ferreries'],
      [['07:40'], ['08:00']],
    );
    const idx = buildIndex(
      toGtfs(
        'TMSA',
        tmsaTablas({ codigo: '654', nombre: 'Es Migjorn Gran-Ferreries' }, parseTimetable(school)),
      ),
      'TMSA',
    );
    const at = (date: string) => stopTimes(idx, 'Es Migjorn Gran', { date, limit: 9 }).total;
    expect(at('2026-11-23')).toBe(1);
    expect(at('2027-01-04')).toBe(0);
    // Pasada Pascua vuelve a haber clase.
    expect(at('2027-04-21')).toBe(1);
  });

  it('fails loudly on a day label it cannot read', () => {
    const odd = block('Temporada alta', 'Maó', ['A', 'B'], [['08:00'], ['08:10']]);
    expect(() => tmsaTablas(linea, parseTimetable(odd))).toThrow('Temporada alta');
  });
});

describe('Bus Torres', () => {
  const t = (name: string, body: string) => siteCsv(name, body);
  const tables = {
    'agency.csv': t('agency.csv', 'agency_id,agency_name\nTORRES,Torres Alles Autocares SL'),
    'routes.csv': t(
      'routes.csv',
      'route_id,agency_id,route_short_name,route_long_name,route_type\n19,TORRES,L19,Maó – Llucmaçanes,3\n10,TORRES,L10,Maó – Aeroport,3\n69,TORRES,L69,Ciutadella – Macarella,3',
    ),
    'stops.csv': t(
      'stops.csv',
      'stop_id,stop_name,stop_lat,stop_lon,stop_code\n2005,Estació d\'autobusos de Maó,"39,88686","4,258341",2005\n2710,Llucmaçanes,"39,87","4,27",2710\n2105,Aeroport,"39,86497","4,226249",2105',
    ),
    'stops_other.csv': t(
      'stops_other.csv',
      '﻿stop_id,stop_name,stop_lat,stop_lon\n6705,Cala Blanes,40.0,3.8',
    ),
    'trips.csv': t(
      'trips.csv',
      'route_id,service_id,trip_id,trip_headsign\n19,1901,1901,Llucmaçanes\n10,H1001,H1001,Aeroport\n69,TA69,TA6901,Macarella',
    ),
    'stop_times_old.csv': t(
      'stop_times_old.csv',
      [
        'trip_id,arrival_time,departure_time,stop_id,stop_sequence',
        '1901,08:15:00,08:15:00,2005,1',
        '1901,08:25:00,08:25:00,2710,2',
        'H1001,06:00:00,06:00:00,2005,1',
        'H1001,06:20:00,06:20:00,2105,2',
        'TA6901,10:00:00,10:00:00,6705,1',
        'TA6901,10:30:00,10:30:00,6705,2',
        // Un viaje que trips.csv ya no tiene, como los H65 de la web.
        'H6501,09:00:00,09:00:00,2005,1',
      ].join('\n'),
    ),
    'calendar.csv': t(
      'calendar.csv',
      'service_id,monday,tuesday,wednesday,thursday,friday,saturday,sunday,start_date,end_date\n1901,0,1,0,0,1,0,0,20260101,20261231\nH1001,1,1,1,1,1,1,1,20260601,20261031\nTA69,1,1,1,1,1,1,1,20260615,20260913',
    ),
    'calendar_dates.csv': t(
      'calendar_dates.csv',
      'service_id,date,exception_type\n1901,20261208,2',
    ),
  };
  const schedule = (
    code: string,
    routeId: string,
    line: string,
    extra: Partial<Generated['schedule']>,
    header: string[],
    rows: string[][],
  ): Generated => ({
    line,
    schedule: {
      code,
      routeId,
      title: 'Maó – Aeroport',
      validFrom: '2026-10-26',
      validUntil: '2027-04-30',
      serviceDaysKey: '1111111',
      ...extra,
    },
    header: ['CodigoParada', 'NombreParada', ...header],
    rows,
  });
  const l10 = schedule(
    '10-20261026-20270430-todos-los-dias',
    '10',
    'L10',
    {
      serviceNote: 'Circula de LUNES a DOMINGO y FESTIVOS',
      alertNote: 'Las horas sombreadas y en negrita circulan de LUNES a VIERNES NO FESTIVOS',
    },
    ['', 'X'],
    [
      ['0', 'Estació d’autobusos de Maó', '05:30', '07:15'],
      ['0', 'Aeroport', '05:45', '07:30'],
      ['0', 'Estació d’autobusos de Maó', '06:10', '07:55'],
    ],
  );
  // El GTFS ya cubre todo 2026 para la L19: su horario a mano no se usa.
  const l19 = schedule(
    '19-20260101-20261231',
    '19',
    'L19',
    { validFrom: '2026-01-01', validUntil: '2026-12-31', serviceDaysKey: '1111111' },
    [''],
    [
      ['2005', "Estació d'autobusos de Maó", '11:11'],
      ['2710', 'Llucmaçanes', '11:21'],
    ],
  );
  // En la L15 la «X» no es «sombreada»: es la salida que solo circula en días lectivos.
  const l15 = schedule(
    '15-20261026-20270531-todos-los-dias',
    '15',
    'L15',
    {
      title: 'Maó centre ciutat',
      serviceNote: 'Circula de LUNES a DOMINGO y FESTIVOS',
      alertNote:
        'Salida 14:15 desde IES Joan Ramis solo circula en días lectivos. No circula sábados, domingos, festivos ni en vacaciones escolares.',
    },
    ['', 'X'],
    [
      ['0', 'IES Joan Ramis', '08:00', '14:15'],
      ['0', 'Camí de Baix', '08:05', '14:20'],
    ],
  );
  const index = buildIndex(combine(tables, [l10, l19, l15], '20261122'), 'Bus Torres');

  it('serves what runs from today on, without past seasons or orphan times', () => {
    expect(findRoutes(index, undefined, 9).lineas.map((r) => r.linea)).toEqual([
      'L10',
      'L15',
      'L19',
    ]);
  });

  it('runs a school-day departure only on school days', () => {
    const at = (date: string) =>
      times(stopTimes(index, 'IES Joan Ramis', { date, route: 'L15', limit: 9 }));
    expect(at('2026-11-23')).toEqual(['08:00 L15', '14:15 L15']);
    // Vacaciones de Navidad, un lunes.
    expect(at('2026-12-28')).toEqual(['08:00 L15']);
    expect(at('2026-11-28')).toEqual(['08:00 L15']);
  });

  it('keeps the GTFS where it covers a hand-made timetable, with its holidays', () => {
    expect(times(stopTimes(index, '2005', { date: '2026-11-24', route: 'L19', limit: 9 }))).toEqual(
      ['08:15 L19'],
    );
    expect(stopTimes(index, '2005', { date: '2026-12-08', route: 'L19', limit: 9 }).total).toBe(0);
  });

  it('runs shaded departures only on working weekdays, and names a loop by its line', () => {
    const sun = stopTimes(index, '2105', { date: '2026-11-22', limit: 9 });
    expect(times(sun)).toEqual(['05:45 L10']);
    expect(sun.salidas[0]?.cabecera).toBe('Maó – Aeroport');
    expect(times(stopTimes(index, '2105', { date: '2026-11-23', limit: 9 }))).toEqual([
      '05:45 L10',
      '07:30 L10',
    ]);
    expect(times(stopTimes(index, 'Aeroport', { date: '2026-12-08', limit: 9 }))).toEqual([
      '05:45 L10',
    ]);
  });

  it('matches stops by name to the GTFS ones, with their coordinates', () => {
    const [stop] = routeStops(index, 'L10').recorridos[0]?.paradas ?? [];
    expect(stop).toMatchObject({ id: '2005', codigo: '2005', lat: 39.88686, lon: 4.258341 });
  });

  it('notices when the site answers a CSV with its home page', () => {
    expect(() => siteCsv('stop_times.csv', '<!DOCTYPE html><html>')).toThrow('stop_times.csv');
  });
});

describe('Tren de Sóller', () => {
  const page = `
    <p>Próximo cierre del Tren: -Desde 23 de noviembre de 2026. -Hasta 01 de febrero de 2027</p>
    <p>Próximo cierre del Tranvía: (Servicio de bus alternativo). desde el 23/11/2026 hasta el 22/12/2026</p>
    <table><tr><th>Salida</th><th></th><th></th><th></th><th>Llegada</th></tr>
      <tr><td>PALMA</td><td></td><td>BUNYOLA</td><td></td><td>SÓLLER</td></tr>
      <tr><td>10:00* 10:30</td><td></td><td>10:25* 10:55</td><td></td><td>11:00* 11:30</td></tr></table>
    <table><tr><th>Salida</th><th></th><th></th><th></th><th>Llegada</th></tr>
      <tr><td>SÓLLER</td><td></td><td>BUNYOLA</td><td></td><td>PALMA</td></tr>
      <tr><td>09:00</td><td></td><td>09:25</td><td></td><td>10:00</td></tr></table>
    <table><tr><td>SÓLLER PUERTO DE SÓLLER</td></tr><tr><td>08:00</td><td>|</td><td>09:00</td></tr></table>
    <table><tr><td>PUERTO DE SÓLLER SÓLLER</td></tr><tr><td>08:30</td><td>|</td><td>09:30</td></tr></table>`;
  const index = buildIndex(
    toGtfs('Ferrocarril de Sóller', sollerTablas(page, '20261122')),
    'Sóller',
  );

  it('reads closure dates in both formats', () => {
    expect(dates('del 23/11/2026 al 1 de febrero de 2027')).toEqual(['20261123', '20270201']);
    expect(closures(page).tranvia).toMatchObject({ desde: '20261123', hasta: '20261222' });
  });

  it('has no departures on closure days, and says why', () => {
    const today = stopTimes(index, 'soller-palma', { date: '2026-11-22', limit: 9 });
    expect(times(today)).toEqual(['10:00 Tren', '10:30 Tren']);
    const closed = stopTimes(index, 'soller-palma', { date: '2026-11-23', limit: 9 });
    expect(closed.total).toBe(0);
    expect(closed.avisos?.[0]).toContain('Cerrado del 23/11/2026 al 01/02/2027');
    expect(closed.avisos?.[0]).toContain('10:00 desde Palma');
  });

  it('gives the tram departures, with only the departure time published', () => {
    expect(times(stopTimes(index, 'Sóller', { date: '2026-12-23', limit: 9 }))).toEqual([
      '08:00 Tranvía',
      '09:00 Tranvía',
    ]);
    expect(
      routeStops(index, 'Tranvía')
        .recorridos.map((r) => r.cabecera)
        .sort(),
    ).toEqual(['Port de Sóller', 'Sóller']);
  });
});

describe('Bus Formentera', () => {
  it('copies every PDF row with one time per stop, always forward in time', () => {
    for (const t of TABLAS) {
      for (const salida of t.salidas) {
        expect(salida).toHaveLength(t.paradas.length);
        const mins = salida
          .filter((h): h is string => h !== null)
          .map((h) => {
            const [hh = 0, mm = 0] = h.split(':').map(Number);
            return hh * 60 + mm;
          });
        expect([...mins].sort((a, b) => a - b)).toEqual(mins);
      }
    }
  });

  it('serves the winter timetable, Sunday service on holidays and the night bus', async () => {
    const index = await loadIndex(fetch, FORMENTERA);
    expect(index.start).toBe('2026-11-01');
    expect(index.end).toBe('2027-04-30');
    const holiday = stopTimes(index, 'Far de la Mola', { date: '2026-12-08', limit: 9 });
    expect(times(holiday)).toEqual(['11:10 L2', '13:10 L2', '15:10 L2', '17:10 L2']);
    const fri = stopTimes(index, 'Port la Savina', { date: '2026-11-27', after: at(22), limit: 9 });
    expect(fri.salidas.map((s) => `${s.hora} ${s.linea}${s.diaSiguiente ? '+1' : ''}`)).toEqual([
      '22:00 L2',
      '00:00 N6+1',
    ]);
  });
});
