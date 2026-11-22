// Servidor MCP de los autobuses de Eivissa (red del Consell d'Eivissa, con la marca TIB): líneas,
// paradas y horarios de su GTFS, que solo se publica en el Punto de Acceso Nacional y pide una clave.
import { SourceError, type Fetch } from './comun';
import type { Feed } from './gtfs';
import { transporteMcp } from './transporte';

const ABOUT = `Autobuses de Eivissa (red del Consell d'Eivissa, eivissa.tib.org): las líneas de Eivissa, Sant Antoni, Santa Eulària, Sant Josep y Sant Joan, el aeropuerto (línea 10), las playas y los Nit Bus (N03-N20), con sus paradas y horarios.
- Las líneas van con su número («03», «10»); también vale sin el cero («3»).
- El horario es el que el Consell publica en el Punto de Acceso Nacional de transporte: si no cubre una fecha, la herramienta lo dice.
- Los de Mallorca, también con la marca TIB, están en el servidor tib.`;

const NAP = 'https://nap.transportes.gob.es/api/Fichero/download/1273';

/** Sin la clave del NAP no hay horarios: se dice en vez de dar una lista vacía. */
const feed = (apiKey: string | undefined): Feed => ({
  label: 'GTFS de los autobuses de Eivissa',
  url: NAP,
  ...(apiKey === undefined
    ? {
        load: () =>
          Promise.reject(
            new SourceError(
              'Los horarios de Eivissa no están disponibles: falta la clave del NAP.',
            ),
          ),
      }
    : { headers: { ApiKey: apiKey } }),
  source:
    "Fuente: Consell Insular d'Eivissa, GTFS en bruto del Punto de Acceso Nacional de Transporte Multimodal. Powered by MITRAMS (https://www.transportes.gob.es/).",
});

export const createBusEivissaMcp = (
  fetchImpl: Fetch = fetch,
  napApiKey = process.env.NAP_API_KEY,
) =>
  transporteMcp({
    info: { name: 'reforma-digital-bus-eivissa', title: 'TIB Eivissa · Autobuses de Eivissa' },
    about: ABOUT,
    feed: feed(napApiKey),
    examples: { line: '«3», «10»', name: '«Sant Antoni»' },
    fetchImpl,
  });
