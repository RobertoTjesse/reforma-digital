// Servidor MCP del transporte público de las Illes Balears: líneas, paradas y horarios publicados de
// cada operador, de su GTFS abierto.
import { z } from 'zod';
import { READ_ONLY_EXTERNAL, run, server, type Fetch } from './comun';
import {
  cachedIndex,
  findRoutes,
  findStops,
  madrid,
  resolveDate,
  routeStops,
  stopTimes,
  type Feed,
  type Index,
} from './gtfs';

const IDS = ['tib', 'emt'] as const;

const OPERADORES: Record<(typeof IDS)[number], Feed> = {
  tib: {
    label: 'GTFS de TIB',
    url: 'https://www.tib.org/documents/20124/478141/ctm-mallorca-es.zip',
    source:
      'Fuente: Consorci de Transports de Mallorca (TIB), GTFS abierto (tib.org), licencia CC BY 4.0.',
  },
  emt: {
    label: 'GTFS de la EMT',
    url: 'https://raw.githubusercontent.com/emtpalma/Open-Data/master/lineas-paradas-horarios-gtfs.zip',
    source:
      'Fuente: Empresa Municipal de Transports Urbans de Palma (EMT Palma), datos abiertos (github.com/emtpalma/Open-Data). La EMT no garantiza que estén al día.',
  },
};

const INSTRUCTIONS = `Transporte público de las Illes Balears: líneas, paradas y horarios publicados por cada operador. Cada herramienta pide el operador:
- tib: buses interurbanos, tren y metro de Mallorca (TIB). Líneas como «204» o «T1».
- emt: buses urbanos de Palma (EMT), incluidos los del aeropuerto (A1, A2) y los nocturnos (N1-N4). Solo da la hora en la cabecera y en unas pocas paradas: en las demás es una estimación por distancia.
- Por ahora solo Mallorca, y sin el Tren de Sóller ni otros urbanos que los de Palma.
- Busca líneas por número o nombre con find_routes, y su recorrido con route_stops.
- Busca paradas por nombre o código con find_stops y usa su id en stop_times. Una estación (tipo «estacion») junta las salidas de todos sus andenes, y un nombre las de todas las paradas que lo llevan (cada salida dice su andén).
- stop_times da las salidas en las que se puede subir, de hoy y desde ahora si no indicas fecha ni hora. Fechas AAAA-MM-DD, today o tomorrow, en hora de Madrid. Sus avisos dicen lo que el operador advierte de cada línea.
- Son horarios programados: no incluyen retrasos ni incidencias en tiempo real. Las salidas que pasan de medianoche llevan diaSiguiente, y las que el operador no publica a esa hora exacta (calculadas por distancia o «cada N minutos») llevan estimada.
Cita la fuente que acompaña a cada resultado.`;

const operador = z
  .enum(IDS)
  .describe('tib (buses, tren y metro de Mallorca) o emt (buses urbanos de Palma).');
const query = z.string().trim().min(1).max(120);
const limit = (n: number) => z.number().int().min(1).max(100).default(n);

export function createIslasMcp(fetchImpl: Fetch = fetch) {
  const use = (id: (typeof IDS)[number], answer: (index: Index) => object) =>
    run(OPERADORES[id].source, async () => answer(await cachedIndex(fetchImpl, OPERADORES[id])));
  return server(
    { name: 'reforma-digital-islas', title: 'Transporte público de las Illes Balears' },
    INSTRUCTIONS,
    (s) => {
      s.registerTool(
        'find_routes',
        {
          title: 'Buscar líneas',
          description:
            'Líneas de un operador por número o nombre, la mejor primero. Sin consulta, todas.',
          inputSchema: z.object({
            operador,
            query: query.optional().describe('Número («204», «L10») o parte del nombre.'),
            limit: limit(10),
          }),
          annotations: READ_ONLY_EXTERNAL,
        },
        (a) => use(a.operador, (index) => findRoutes(index, a.query, a.limit)),
      );
      s.registerTool(
        'find_stops',
        {
          title: 'Buscar paradas',
          description:
            'Paradas y estaciones de un operador por nombre o código, la mejor primero, con el id para stop_times.',
          inputSchema: z.object({
            operador,
            query: query.describe('Parte del nombre o el código.'),
            limit: limit(10),
          }),
          annotations: READ_ONLY_EXTERNAL,
        },
        (a) => use(a.operador, (index) => findStops(index, a.query, a.limit)),
      );
      s.registerTool(
        'route_stops',
        {
          title: 'Recorrido de una línea',
          description:
            'Las paradas de una línea en orden, un recorrido por cabecera (destino), y el número de viajes.',
          inputSchema: z.object({
            operador,
            route: query.describe('Número de línea o id de find_routes.'),
          }),
          annotations: READ_ONLY_EXTERNAL,
        },
        (a) => use(a.operador, (index) => routeStops(index, a.route)),
      );
      s.registerTool(
        'stop_times',
        {
          title: 'Salidas de una parada',
          description:
            'Salidas programadas de una parada o estación en una fecha, en las que se puede subir: hora, línea y cabecera. Sin fecha ni hora, las de hoy desde ahora. No es tiempo real.',
          inputSchema: z.object({
            operador,
            stop: query.describe('Id, código o nombre de la parada (de find_stops).'),
            date: z
              .string()
              .default('today')
              .describe('AAAA-MM-DD, today o tomorrow (hora de Madrid).'),
            route: query.optional().describe('Solo esta línea, por número o id.'),
            after: z
              .string()
              .regex(/^([01]?\d|2[0-3]):[0-5]\d$/)
              .optional()
              .describe('Solo salidas desde esta hora, HH:MM.'),
            limit: limit(20),
          }),
          annotations: READ_ONLY_EXTERNAL,
        },
        (a) =>
          use(a.operador, (index) => {
            // Un solo instante: a medianoche, dos lecturas del reloj podrían caer en días distintos.
            const instant = Date.now();
            const now = madrid(instant);
            const date = resolveDate(a.date, instant);
            const [h = 0, m = 0] = a.after === undefined ? [] : a.after.split(':').map(Number);
            const after =
              a.after !== undefined
                ? h * 3600 + m * 60
                : date === now.date
                  ? now.seconds
                  : undefined;
            return stopTimes(index, a.stop, { date, route: a.route, after, limit: a.limit });
          }),
      );
    },
  );
}
