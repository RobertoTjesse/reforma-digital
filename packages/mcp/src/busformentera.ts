// Servidor MCP del bus de Formentera (Autocares Payà, busformentera.com). El operador solo
// publica sus horarios en PDF, maquetados como cartel: no se pueden leer de forma fiable al vuelo.
// Aquí van copiados a mano del PDF del horario de invierno 2026/2027, tal cual, fila a fila; al
// cambiar el horario hay que volver a copiarlos (y cambiar las fechas de validez).
import type { Fetch } from './comun';
import type { Feed } from './gtfs';
import { toGtfs, ymds, type Parada, type Tabla } from './horarios';
import { transporteMcp } from './transporte';

const PDF = 'https://busformentera.com/wp-content/uploads/2026/10/A3-HORARIO-2027.pdf';
const DESDE = '20261101';
const HASTA = '20270430';
/** Festivos de las Illes Balears más los de Formentera (Sant Jaume y Sant Francesc Xavier). Los
 * locales de 2027 aún no estaban publicados al copiar el horario. */
const FESTIVOS = ymds(`
  20261203 20261208 20261225 20261226 20270101 20270106 20270301 20270325 20270326 20270329`);

const P = (id: string, nombre: string): Parada => ({ id: `fm-${id}`, nombre });
const PORT = P('port-la-savina', 'Port la Savina');
const SANT_FRANCESC = P('sant-francesc', 'Sant Francesc');
const VIAL = P('vial-sant-ferran', 'Vial Sant Ferran');
const PUJOLS = P('es-pujols', 'Es Pujols');
const SANT_FERRAN = P('sant-ferran', 'Sant Ferran');
const CALO = P('es-calo', 'Es Caló');
const PILAR = P('el-pilar', 'El Pilar de la Mola');
const FAR = P('far-de-la-mola', 'Far de la Mola');

/** Sentido Far: de Port la Savina al Far de la Mola. Sentido Port: al revés. */
const HACIA_FAR = [PORT, SANT_FRANCESC, VIAL, PUJOLS, SANT_FERRAN, CALO, PILAR, FAR];
const HACIA_PORT = [...HACIA_FAR].reverse();

/** Filas del PDF: una hora por parada en el orden de su sentido, «-» si no llega. */
const filas = (text: string) =>
  text
    .trim()
    .split('\n')
    .map((row) =>
      row
        .trim()
        .split(/\s+/)
        .map((h) => (h === '-' ? null : h)),
    );

const L2 = {
  id: 'L2',
  numero: 'L2',
  nombre:
    'Port la Savina - Sant Francesc - Es Pujols - Sant Ferran - Es Caló - El Pilar - Far de la Mola',
  nota: 'La salida de las 06:15 de El Pilar (de lunes a viernes) es a demanda: hay que reservarla con 24 horas de antelación en el +34 695 161 636 (de 9 a 18 h) o en reservas@autocarespaya.com. La de las 22:00 de Port la Savina (de lunes a viernes) es a demanda pasado Es Pujols, salvo los viernes, que siempre llega a El Pilar. Al Far de la Mola solo llegan algunas salidas.',
};
const N6 = {
  id: 'N6',
  numero: 'N6',
  nombre: 'Nitbus Port la Savina - El Pilar de la Mola',
  nota: 'Bus nocturno de los viernes y sábados por la noche: sale de Port la Savina a las 00:00, ya de madrugada del sábado y del domingo.',
};

const tabla = (
  linea: Tabla['linea'],
  paradas: Parada[],
  dias: string,
  festivos: Tabla['festivos'],
  rows: string,
): Tabla => ({
  linea,
  cabecera: paradas.at(-1)!.nombre,
  dias,
  festivos,
  desde: DESDE,
  hasta: HASTA,
  paradas,
  salidas: filas(rows),
});

// «De dilluns a divendres», «Dissabtes» y «Diumenges i festius» del PDF, sentido Far y sentido Port.
export const TABLAS: Tabla[] = [
  tabla(
    L2,
    HACIA_FAR,
    '1111100',
    'no',
    `
    07:20 07:30 07:35 07:40 07:45 07:55 08:00 08:05
    08:20 08:30 08:35 08:40 08:45 08:55 09:00 -
    09:20 09:30 09:35 09:40 09:45 09:55 10:00 -
    10:20 10:30 10:35 10:40 10:45 10:55 11:00 11:05
    11:20 11:30 11:35 11:40 11:45 11:55 12:00 -
    12:20 12:30 12:35 12:40 12:45 12:55 13:00 13:05
    13:20 13:30 13:35 13:40 13:45 13:55 14:00 -
    14:20 14:30 14:35 14:40 14:45 14:55 15:00 -
    15:20 15:30 15:35 15:40 15:45 15:55 16:00 16:05
    16:20 16:30 16:35 16:40 16:45 16:55 17:00 -
    17:20 17:30 17:35 17:40 17:45 17:55 18:00 18:05
    18:20 18:30 18:35 18:40 18:45 18:55 19:00 -
    19:20 19:30 19:35 19:40 19:45 19:55 20:00 -
    20:20 20:30 20:35 20:40 20:45 20:55 21:00 -
    21:20 21:30 21:35 21:40 21:45 21:55 22:00 -
    22:00 22:10 22:15 22:20 22:25 22:35 22:40 -`,
  ),
  tabla(
    L2,
    HACIA_PORT,
    '1111100',
    'no',
    `
    - 06:15 06:20 06:30 06:35 06:40 06:45 06:55
    - 07:15 07:20 07:30 07:35 07:40 07:45 07:55
    08:10 08:15 08:20 08:30 08:35 08:40 08:45 08:55
    - 09:15 09:20 09:30 09:35 09:40 09:45 09:55
    - 10:15 10:20 10:30 10:35 10:40 10:45 10:55
    11:10 11:15 11:20 11:30 11:35 11:40 11:45 11:55
    - 12:15 12:20 12:30 12:35 12:40 12:45 12:55
    13:10 13:15 13:20 13:30 13:35 13:40 13:45 13:55
    - 14:15 14:20 14:30 14:35 14:40 14:45 14:55
    - 15:15 15:20 15:30 15:35 15:40 15:45 15:55
    16:10 16:15 16:20 16:30 16:35 16:40 16:45 16:55
    - 17:15 17:20 17:30 17:35 17:40 17:45 17:55
    18:10 18:15 18:20 18:30 18:35 18:40 18:45 18:55
    - 19:15 19:20 19:30 19:35 19:40 19:45 19:55
    - 20:15 20:20 20:30 20:35 20:40 20:45 20:55
    - 21:10 21:15 21:25 21:30 21:35 21:40 21:50`,
  ),
  tabla(
    L2,
    HACIA_FAR,
    '0000010',
    'no',
    `
    07:20 07:30 07:35 07:40 07:45 07:55 08:00 -
    08:20 08:30 08:35 08:40 08:45 08:55 09:00 -
    09:20 09:30 09:35 09:40 09:45 09:55 10:00 10:05
    10:20 10:30 10:35 10:40 10:45 10:55 11:00 -
    11:20 11:30 11:35 11:40 11:45 11:55 12:00 12:05
    12:20 12:30 12:35 12:40 12:45 12:55 13:00 -
    13:20 13:30 13:35 13:40 13:45 13:55 14:00 14:05
    14:20 14:30 14:35 14:40 14:45 14:55 15:00 15:05
    16:20 16:30 16:35 16:40 16:45 16:55 17:00 17:05
    18:20 18:30 18:35 18:40 18:45 18:55 19:00 -
    20:20 20:30 20:35 20:40 20:45 20:55 21:00 -
    22:00 22:10 22:15 22:20 22:25 22:35 22:40 -`,
  ),
  tabla(
    L2,
    HACIA_PORT,
    '0000010',
    'no',
    `
    - 07:15 07:20 07:30 07:35 07:40 07:45 07:55
    - 08:15 08:20 08:30 08:35 08:40 08:45 08:55
    - 09:15 09:20 09:30 09:35 09:40 09:45 09:55
    10:10 10:15 10:20 10:30 10:35 10:40 10:45 10:55
    - 11:15 11:20 11:30 11:35 11:40 11:45 11:55
    12:10 12:15 12:20 12:30 12:35 12:40 12:45 12:55
    - 13:15 13:20 13:30 13:35 13:40 13:45 13:55
    14:10 14:15 14:20 14:30 14:35 14:40 14:45 14:55
    15:10 15:15 15:20 15:30 15:35 15:40 15:45 15:55
    17:10 17:15 17:20 17:30 17:35 17:40 17:45 17:55
    - 19:15 19:20 19:30 19:35 19:40 19:45 19:55
    - 21:10 21:15 21:25 21:35 21:40 21:40 21:50`,
  ),
  tabla(
    L2,
    HACIA_FAR,
    '0000001',
    'si',
    `
    08:20 08:30 08:35 08:40 08:45 08:55 09:00 -
    10:20 10:30 10:35 10:40 10:45 10:55 11:00 11:05
    12:20 12:30 12:35 12:40 12:45 12:55 13:00 13:05
    14:20 14:30 14:35 14:40 14:45 14:55 15:00 15:05
    16:20 16:30 16:35 16:40 16:45 16:55 17:00 17:05
    18:20 18:30 18:35 18:40 18:45 18:55 19:00 -
    20:30 20:40 20:45 20:50 20:55 21:05 21:10 -`,
  ),
  tabla(
    L2,
    HACIA_PORT,
    '0000001',
    'si',
    `
    - 09:15 09:20 09:30 09:35 09:40 09:45 09:55
    11:10 11:15 11:20 11:30 11:35 11:40 11:45 11:55
    13:10 13:15 13:20 13:30 13:35 13:40 13:45 13:55
    15:10 15:15 15:20 15:30 15:35 15:40 15:45 15:55
    17:10 17:15 17:20 17:30 17:35 17:40 17:45 17:55
    - 19:15 19:20 19:30 19:35 19:40 19:45 19:55`,
  ),
  // N6, «divendres i dissabtes»: la vuelta sale a las 23:00 de El Pilar y la ida a las 00:00 de
  // Port la Savina, ya de madrugada (24:00 del viernes y del sábado).
  tabla(N6, HACIA_FAR, '0000110', 'igual', `24:00 24:10 24:15 24:20 24:25 24:35 24:40 -`),
  tabla(N6, HACIA_PORT, '0000110', 'igual', `- 23:00 23:05 23:15 23:20 23:30 23:40 23:45`),
];

export const FORMENTERA: Feed = {
  label: 'horario de invierno de Bus Formentera',
  url: PDF,
  load: async () => toGtfs('Autocares Payà (Bus Formentera)', TABLAS, FESTIVOS),
  source: `Fuente: Autocares Payà (Bus Formentera), horario de invierno 2026/2027 en PDF (${PDF}), copiado a mano. Confírmalo en busformentera.com.`,
};

const ABOUT = `Autobuses de Formentera (Autocares Payà, busformentera.com) en el horario de invierno 2026/2027, del 1 de noviembre de 2026 al 30 de abril de 2027: la L2 de Port la Savina (el puerto de los barcos de Eivissa) a Sant Francesc, Es Pujols, Sant Ferran, Es Caló, El Pilar y el Far de la Mola, y el bus nocturno N6 de los viernes y sábados.
- Copiado a mano del PDF del operador: fuera de esas fechas no hay horarios, y el resto de líneas (L1, L3 turística, L5 Cala Saona, L7 Illetes) son de verano o sin horario de invierno publicado.
- Hay salidas a demanda que hay que reservar: lo dicen los avisos de cada línea.`;

export const createBusFormenteraMcp = (fetchImpl: Fetch = fetch) =>
  transporteMcp({
    info: {
      name: 'reforma-digital-bus-formentera',
      title: 'Bus Formentera · Autobuses de Formentera',
    },
    about: ABOUT,
    feed: FORMENTERA,
    examples: { line: '«L2», «N6»', name: '«Far de la Mola»' },
    fetchImpl,
  });
