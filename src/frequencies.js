'use strict';

const transponders = [
  // Astra 28.2°E
  { name: 'Astra 28.2 – 10773', satellite: 'Astra 28.2°E', frequency: 10773, polarisation: 'H', symbol_rate: 22000, delivery_system: 'DVBS',  fec: '5/6' },
  { name: 'Astra 28.2 – 10714', satellite: 'Astra 28.2°E', frequency: 10714, polarisation: 'H', symbol_rate: 22000, delivery_system: 'DVBS',  fec: '5/6' },
  { name: 'Astra 28.2 – 10847', satellite: 'Astra 28.2°E', frequency: 10847, polarisation: 'H', symbol_rate: 22000, delivery_system: 'DVBS',  fec: '5/6' },
  { name: 'Astra 28.2 – 10788', satellite: 'Astra 28.2°E', frequency: 10788, polarisation: 'H', symbol_rate: 22000, delivery_system: 'DVBS',  fec: '5/6' },
  { name: 'Astra 28.2 – 10862', satellite: 'Astra 28.2°E', frequency: 10862, polarisation: 'H', symbol_rate: 22000, delivery_system: 'DVBS',  fec: '5/6' },
  { name: 'Astra 28.2 – 11836', satellite: 'Astra 28.2°E', frequency: 11836, polarisation: 'H', symbol_rate: 27500, delivery_system: 'DVBS2', fec: '2/3' },
  { name: 'Astra 28.2 – 10971', satellite: 'Astra 28.2°E', frequency: 10971, polarisation: 'V', symbol_rate: 22000, delivery_system: 'DVBS',  fec: '5/6' },
  { name: 'Astra 28.2 – 11954', satellite: 'Astra 28.2°E', frequency: 11954, polarisation: 'H', symbol_rate: 27500, delivery_system: 'DVBS2', fec: '2/3' },

  // Astra 19.2°E
  { name: 'Astra 19.2 – 10744', satellite: 'Astra 19.2°E', frequency: 10744, polarisation: 'H', symbol_rate: 22000, delivery_system: 'DVBS2', fec: '3/4' },
  { name: 'Astra 19.2 – 10817', satellite: 'Astra 19.2°E', frequency: 10817, polarisation: 'H', symbol_rate: 22000, delivery_system: 'DVBS2', fec: '3/4' },
  { name: 'Astra 19.2 – 10832', satellite: 'Astra 19.2°E', frequency: 10832, polarisation: 'V', symbol_rate: 22000, delivery_system: 'DVBS2', fec: '3/4' },
  { name: 'Astra 19.2 – 10876', satellite: 'Astra 19.2°E', frequency: 10876, polarisation: 'H', symbol_rate: 22000, delivery_system: 'DVBS2', fec: '3/4' },
  { name: 'Astra 19.2 – 10921', satellite: 'Astra 19.2°E', frequency: 10921, polarisation: 'H', symbol_rate: 27500, delivery_system: 'DVBS2', fec: '3/4' },
  { name: 'Astra 19.2 – 11038', satellite: 'Astra 19.2°E', frequency: 11038, polarisation: 'H', symbol_rate: 22000, delivery_system: 'DVBS2', fec: '3/4' },
  { name: 'Astra 19.2 – 11229', satellite: 'Astra 19.2°E', frequency: 11229, polarisation: 'H', symbol_rate: 22000, delivery_system: 'DVBS2', fec: '3/4' },
  { name: 'Astra 19.2 – 11347', satellite: 'Astra 19.2°E', frequency: 11347, polarisation: 'H', symbol_rate: 22000, delivery_system: 'DVBS2', fec: '3/4' },
  { name: 'Astra 19.2 – 11420', satellite: 'Astra 19.2°E', frequency: 11420, polarisation: 'H', symbol_rate: 22000, delivery_system: 'DVBS2', fec: '3/4' },
  { name: 'Astra 19.2 – 11508', satellite: 'Astra 19.2°E', frequency: 11508, polarisation: 'V', symbol_rate: 22000, delivery_system: 'DVBS2', fec: '3/4' },
  { name: 'Astra 19.2 – 11523', satellite: 'Astra 19.2°E', frequency: 11523, polarisation: 'H', symbol_rate: 22000, delivery_system: 'DVBS2', fec: '3/4' },

  // Hotbird 13°E
  { name: 'Hotbird 13 – 10815', satellite: 'Hotbird 13°E', frequency: 10815, polarisation: 'H', symbol_rate: 27500, delivery_system: 'DVBS2', fec: '3/4' },
  { name: 'Hotbird 13 – 10853', satellite: 'Hotbird 13°E', frequency: 10853, polarisation: 'H', symbol_rate: 27500, delivery_system: 'DVBS2', fec: '3/4' },
  { name: 'Hotbird 13 – 10873', satellite: 'Hotbird 13°E', frequency: 10873, polarisation: 'V', symbol_rate: 29900, delivery_system: 'DVBS2', fec: '3/4' },
  { name: 'Hotbird 13 – 11179', satellite: 'Hotbird 13°E', frequency: 11179, polarisation: 'H', symbol_rate: 27500, delivery_system: 'DVBS2', fec: '3/4' },
  { name: 'Hotbird 13 – 11296', satellite: 'Hotbird 13°E', frequency: 11296, polarisation: 'H', symbol_rate: 27500, delivery_system: 'DVBS2', fec: '3/4' },
  { name: 'Hotbird 13 – 11354', satellite: 'Hotbird 13°E', frequency: 11354, polarisation: 'H', symbol_rate: 27500, delivery_system: 'DVBS2', fec: '3/4' },
  { name: 'Hotbird 13 – 11432', satellite: 'Hotbird 13°E', frequency: 11432, polarisation: 'H', symbol_rate: 27500, delivery_system: 'DVBS2', fec: '3/4' },
  { name: 'Hotbird 13 – 11538', satellite: 'Hotbird 13°E', frequency: 11538, polarisation: 'H', symbol_rate: 27500, delivery_system: 'DVBS2', fec: '3/4' },
  { name: 'Hotbird 13 – 11642', satellite: 'Hotbird 13°E', frequency: 11642, polarisation: 'H', symbol_rate: 27500, delivery_system: 'DVBS2', fec: '3/4' },
  { name: 'Hotbird 13 – 11747', satellite: 'Hotbird 13°E', frequency: 11747, polarisation: 'H', symbol_rate: 27500, delivery_system: 'DVBS2', fec: '3/4' }
];

function getAll() {
  return transponders;
}

function getBySatellite(satellite) {
  return transponders.filter(t => t.satellite === satellite);
}

function getByFrequency(frequency) {
  return transponders.filter(t => t.frequency === Number(frequency));
}

function getSatellites() {
  return [...new Set(transponders.map(t => t.satellite))];
}

function findTransponder(frequency, polarisation) {
  return transponders.find(
    t => t.frequency === Number(frequency) && t.polarisation === polarisation
  ) || null;
}

module.exports = { getAll, getBySatellite, getByFrequency, getSatellites, findTransponder };
