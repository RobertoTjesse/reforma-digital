// Servidor MCP de los autobuses de Eivissa (red del Consell d'Eivissa, con la marca TIB): líneas,
// paradas y horarios de su GTFS. El Consell solo lo publica en el Punto de Acceso Nacional, que pide
// una clave; se lee de la copia pública de Mobility Database, que lo descarga de allí cada día.
import type { Fetch } from './comun';
import { transporteMcp } from './transporte';

const ABOUT = `Autobuses de Eivissa (red del Consell d'Eivissa, eivissa.tib.org): las líneas de Eivissa, Sant Antoni, Santa Eulària, Sant Josep y Sant Joan, el aeropuerto (línea 10), las playas y los Nit Bus (N03-N20), con sus paradas y horarios.
- Las líneas van con su número («03», «10»); también vale sin el cero («3»).
- El horario es el que el Consell publica en el Punto de Acceso Nacional de transporte: si no cubre una fecha, la herramienta lo dice.
- Los de Mallorca, también con la marca TIB, están en el servidor tib.`;

export const createBusEivissaMcp = (fetchImpl: Fetch = fetch) =>
  transporteMcp({
    info: { name: 'reforma-digital-bus-eivissa', title: 'TIB Eivissa · Autobuses de Eivissa' },
    about: ABOUT,
    feed: {
      label: 'GTFS de los autobuses de Eivissa',
      url: 'https://files.mobilitydatabase.org/mdb-2797/latest.zip',
      source:
        "Fuente: Consell Insular d'Eivissa, GTFS en bruto del Punto de Acceso Nacional de Transporte Multimodal, vía Mobility Database (mobilitydatabase.org). Powered by MITRAMS (https://www.transportes.gob.es/).",
    },
    examples: { line: '«3», «10»', name: '«Sant Antoni»' },
    fetchImpl,
  });
