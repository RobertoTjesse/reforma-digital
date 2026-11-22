// @vitest-environment node
// TMSA sin red: trozos de HTML con la forma de los de tmsa.es, y los festivos, el calendario escolar
// y los rótulos de días de horarios.ts.
import { describe, expect, it } from 'vitest';
import { buildIndex, findRoutes, routeStops, stopTimes } from './gtfs';
import { lectivo, parseDays, toGtfs } from './horarios';
import { parseLines, parseTimetable, toTablas as tmsaTablas } from './tmsa';

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
    expect(parseDays('De Lunes a Viernes excepto los festivos')?.festivos).toBe(false);
    expect(parseDays('Festivos')).toEqual({ dias: '0000000', festivos: true });
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

  it('ends a school-day table with the last published school year instead of going silent', () => {
    const tabla = {
      ...base,
      dias: '1111100',
      festivos: 'no' as const,
      salidas: [['08:00', '08:30']],
    };
    const school = { ...tabla, desde: '20270601', hasta: '20270930', soloLectivos: true };
    const idx = buildIndex(toGtfs('Operador', [school]), 'horario escolar');
    expect(idx.end).toBe('2027-06-18');
    expect(() => stopTimes(idx, 'a', { date: '2027-09-20', limit: 9 })).toThrow(/2027-06-18/);
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
