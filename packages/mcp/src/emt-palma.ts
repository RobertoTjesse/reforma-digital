// Servidor MCP de la EMT de Palma: líneas, paradas y horarios de los autobuses urbanos de Palma, de
// su GTFS abierto en GitHub. La EMT publica cada recorrido como una plantilla con frecuencias y solo
// la hora de unas pocas paradas: la del resto se estima por la distancia recorrida.
import type { Fetch } from './comun';
import { transporteMcp } from './transporte';

const ABOUT = `Autobuses urbanos de Palma (EMT Palma): sus líneas, incluidas las del aeropuerto (A1, A2) y las nocturnas (N1-N4), sus paradas y los horarios publicados.
- La EMT solo da la hora de salida en la cabecera y en unas pocas paradas; en las demás es una estimación por distancia, así que puede variar unos minutos.
- Los buses interurbanos, el tren y el metro de Mallorca son de TIB, que tiene su propio servidor.`;

export const createEmtPalmaMcp = (fetchImpl: Fetch = fetch) =>
  transporteMcp({
    info: { name: 'reforma-digital-emt-palma', title: 'EMT Palma · Autobuses urbanos de Palma' },
    about: ABOUT,
    feed: {
      label: 'GTFS de la EMT',
      url: 'https://raw.githubusercontent.com/emtpalma/Open-Data/master/lineas-paradas-horarios-gtfs.zip',
      source:
        'Fuente: Empresa Municipal de Transports Urbans de Palma (EMT Palma), datos abiertos (github.com/emtpalma/Open-Data). La EMT no garantiza que estén al día.',
    },
    examples: { line: '«3», «A1»', name: '«Aeroport»' },
    fetchImpl,
  });
