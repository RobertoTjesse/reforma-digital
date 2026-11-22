// @vitest-environment node
// Bus Torres sin red: trozos de CSV y JSON con la forma de los de bustorresmenorca.com.
import { describe, expect, it } from 'vitest';
import { combine, siteCsv, type Generated } from './bustorres';
import { buildIndex, findRoutes, routeStops, stopTimes } from './gtfs';

const times = (r: ReturnType<typeof stopTimes>) => r.salidas.map((s) => `${s.hora} ${s.linea}`);

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
