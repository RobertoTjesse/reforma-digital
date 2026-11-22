// @vitest-environment node
// TIB Eivissa sin red: un GTFS mínimo con la forma del que publica el Consell.
import { strToU8, zipSync } from 'fflate';
import { describe, expect, it, vi } from 'vitest';
import { createBusEivissaMcp } from './eivissa';

describe('Eivissa', () => {
  const zip = zipSync(
    Object.fromEntries(
      Object.entries({
        'agency.txt': 'agency_id,agency_name\n42,Autobuses San Antonio SA',
        'routes.txt':
          'route_id,agency_id,route_short_name,route_long_name,route_type\n1997,42,03,Sant Antoni <> Eivissa,3',
        'stops.txt': 'stop_id,stop_name\n1,Sant Antoni\n2,Eivissa',
        'calendar.txt':
          'service_id,monday,tuesday,wednesday,thursday,friday,saturday,sunday,start_date,end_date\nS,1,1,1,1,1,1,1,20260101,20261231',
        'trips.txt': 'route_id,service_id,trip_id,trip_headsign\n1997,S,t,Eivissa',
        'stop_times.txt':
          'trip_id,arrival_time,departure_time,stop_id,stop_sequence\nt,08:00:00,08:00:00,1,1\nt,08:30:00,08:30:00,2,2',
      }).map(([name, text]) => [name, strToU8(text)]),
    ),
  );
  it('downloads the public copy of the feed, without a key, and finds line «3» as «03»', async () => {
    const fetchImpl = vi.fn<typeof fetch>(async () => new Response(zip));
    const response = await createBusEivissaMcp(fetchImpl).fetch(
      new Request('http://localhost/mcp', {
        method: 'POST',
        headers: {
          'content-type': 'application/json',
          accept: 'application/json, text/event-stream',
          'mcp-protocol-version': '2025-06-18',
        },
        body: JSON.stringify({
          jsonrpc: '2.0',
          id: 1,
          method: 'tools/call',
          params: { name: 'route_stops', arguments: { route: '3' } },
        }),
      }),
    );
    const data = (await response.text()).match(/^data: (.*)$/m)?.[1];
    const { result } = JSON.parse(data ?? 'null') as { result: { content: { text: string }[] } };
    expect(fetchImpl.mock.calls[0]?.[0]).toContain('mobilitydatabase.org');
    expect(JSON.parse(result.content[0]?.text ?? '').linea.linea).toBe('03');
    expect(result.content[1]?.text).toContain('Powered by MITRAMS');
  });
});
