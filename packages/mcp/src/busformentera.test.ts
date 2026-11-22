// @vitest-environment node
// Bus Formentera: el horario copiado a mano de su PDF, sin red.
import { describe, expect, it } from 'vitest';
import { FORMENTERA, TABLAS } from './busformentera';
import { loadIndex, stopTimes } from './gtfs';

const at = (h: number) => h * 3600;
const times = (r: ReturnType<typeof stopTimes>) => r.salidas.map((s) => `${s.hora} ${s.linea}`);

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
