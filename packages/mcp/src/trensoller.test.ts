// @vitest-environment node
// El Tren de Sóller sin red: trozos de HTML con la forma de los de su web.
import { describe, expect, it } from 'vitest';
import { buildIndex, routeStops, stopTimes } from './gtfs';
import { days, toGtfs } from './horarios';
import { closures, dates, toTablas as sollerTablas } from './trensoller';

const times = (r: ReturnType<typeof stopTimes>) => r.salidas.map((s) => `${s.hora} ${s.linea}`);

describe('horarios', () => {
  const paradas = [
    { id: 'a', nombre: 'A' },
    { id: 'b', nombre: 'B' },
  ];
  const linea = { id: 'X', numero: 'X1', nombre: 'Prueba' };
  const base = { linea, cabecera: 'B', desde: '20261201', hasta: '20261231', paradas };
  const files = toGtfs('Operador', [
    { ...base, cierres: ['20261224'], salidas: [['23:50', '0:20']] },
    { ...base, salidas: [['08:00', '08:30']] },
  ]);
  const index = buildIndex(files, 'horario de prueba');

  it('honours closures of one table only', () => {
    expect(times(stopTimes(index, 'a', { date: '2026-12-23', limit: 9 }))).toEqual([
      '08:00 X1',
      '23:50 X1',
    ]);
    expect(times(stopTimes(index, 'a', { date: '2026-12-24', limit: 9 }))).toEqual(['08:00 X1']);
  });

  it('carries a trip past midnight instead of going back in time', () => {
    expect(stopTimes(index, 'b', { date: '2026-12-10', limit: 9 }).salidas).toEqual([]);
    expect(files.get('stop_times.txt')?.some((r) => r.departure_time === '24:20:00')).toBe(true);
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

  it('keeps the dates of a fully closed line, so a closed day explains why', () => {
    // Desde el 23 el tren cierra todo el horizonte y el tranvía hasta el 22 de diciembre.
    const closed = buildIndex(
      toGtfs('Ferrocarril de Sóller', sollerTablas(page, '20261123')),
      'Sóller',
    );
    const r = stopTimes(closed, 'soller-palma', { date: '2026-11-25', limit: 9 });
    expect(r.total).toBe(0);
    expect(r.avisos?.[0]).toContain('Cerrado del 23/11/2026');
  });

  it('counts every day of a long timetable, not just the first ones', () => {
    expect([...days('20240101', '20261231')]).toHaveLength(1096);
  });

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
