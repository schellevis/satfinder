'use strict';

const transponders = [
  // Astra 28.2°E
  { name: 'Astra 28.2 – 10773 H', satellite: 'Astra 28.2°E', frequency: 10773, polarisation: 'H', symbol_rate: 23000, delivery_system: 'DVBS2', fec: '3/4' },
  { name: 'Astra 28.2 – 10788 V', satellite: 'Astra 28.2°E', frequency: 10788, polarisation: 'V', symbol_rate: 23000, delivery_system: 'DVBS2', fec: '3/4' },
  { name: 'Astra 28.2 – 10818 V', satellite: 'Astra 28.2°E', frequency: 10818, polarisation: 'V', symbol_rate: 23000, delivery_system: 'DVBS2', fec: '3/4' },
  { name: 'Astra 28.2 – 10847 V', satellite: 'Astra 28.2°E', frequency: 10847, polarisation: 'V', symbol_rate: 23000, delivery_system: 'DVBS2', fec: '3/4' },
  { name: 'Astra 28.2 – 10936 V', satellite: 'Astra 28.2°E', frequency: 10936, polarisation: 'V', symbol_rate: 23000, delivery_system: 'DVBS2', fec: '3/4' },
  { name: 'Astra 28.2 – 11023 H', satellite: 'Astra 28.2°E', frequency: 11023, polarisation: 'H', symbol_rate: 23000, delivery_system: 'DVBS2', fec: '3/4' },
  { name: 'Astra 28.2 – 11082 H', satellite: 'Astra 28.2°E', frequency: 11082, polarisation: 'H', symbol_rate: 23000, delivery_system: 'DVBS2', fec: '2/3' },
  { name: 'Astra 28.2 – 11112 H', satellite: 'Astra 28.2°E', frequency: 11112, polarisation: 'H', symbol_rate: 23000, delivery_system: 'DVBS2', fec: '2/3' },
  { name: 'Astra 28.2 – 11141 H', satellite: 'Astra 28.2°E', frequency: 11141, polarisation: 'H', symbol_rate: 23000, delivery_system: 'DVBS2', fec: '2/3' },
  { name: 'Astra 28.2 – 11224 H', satellite: 'Astra 28.2°E', frequency: 11224, polarisation: 'H', symbol_rate: 27500, delivery_system: 'DVBS', fec: '2/3' },
  { name: 'Astra 28.2 – 11224 V', satellite: 'Astra 28.2°E', frequency: 11224, polarisation: 'V', symbol_rate: 23000, delivery_system: 'DVBS2', fec: '2/3' },
  { name: 'Astra 28.2 – 11264 V', satellite: 'Astra 28.2°E', frequency: 11264, polarisation: 'V', symbol_rate: 27500, delivery_system: 'DVBS', fec: '2/3' },
  { name: 'Astra 28.2 – 11305 H', satellite: 'Astra 28.2°E', frequency: 11305, polarisation: 'H', symbol_rate: 27500, delivery_system: 'DVBS', fec: '2/3' },
  { name: 'Astra 28.2 – 11306 V', satellite: 'Astra 28.2°E', frequency: 11306, polarisation: 'V', symbol_rate: 27500, delivery_system: 'DVBS', fec: '5/6' },
  { name: 'Astra 28.2 – 11344 H', satellite: 'Astra 28.2°E', frequency: 11344, polarisation: 'H', symbol_rate: 27500, delivery_system: 'DVBS2', fec: '2/3' },
  { name: 'Astra 28.2 – 11344 V', satellite: 'Astra 28.2°E', frequency: 11344, polarisation: 'V', symbol_rate: 27500, delivery_system: 'DVBS2', fec: '2/3' },
  { name: 'Astra 28.2 – 11386 H', satellite: 'Astra 28.2°E', frequency: 11386, polarisation: 'H', symbol_rate: 27500, delivery_system: 'DVBS2', fec: '2/3' },
  { name: 'Astra 28.2 – 11386 V', satellite: 'Astra 28.2°E', frequency: 11386, polarisation: 'V', symbol_rate: 27500, delivery_system: 'DVBS2', fec: '2/3' },
  { name: 'Astra 28.2 – 11426 H', satellite: 'Astra 28.2°E', frequency: 11426, polarisation: 'H', symbol_rate: 27500, delivery_system: 'DVBS', fec: '2/3' },
  { name: 'Astra 28.2 – 11426 V', satellite: 'Astra 28.2°E', frequency: 11426, polarisation: 'V', symbol_rate: 29500, delivery_system: 'DVBS2', fec: '8/9' },
  { name: 'Astra 28.2 – 11494 H', satellite: 'Astra 28.2°E', frequency: 11494, polarisation: 'H', symbol_rate: 22000, delivery_system: 'DVBS', fec: '5/6' },
  { name: 'Astra 28.2 – 11523 H', satellite: 'Astra 28.2°E', frequency: 11523, polarisation: 'H', symbol_rate: 23000, delivery_system: 'DVBS2', fec: '2/3' },
  { name: 'Astra 28.2 – 11553 H', satellite: 'Astra 28.2°E', frequency: 11553, polarisation: 'H', symbol_rate: 23000, delivery_system: 'DVBS2', fec: '2/3' },
  { name: 'Astra 28.2 – 11582 H', satellite: 'Astra 28.2°E', frequency: 11582, polarisation: 'H', symbol_rate: 23000, delivery_system: 'DVBS2', fec: '2/3' },
  { name: 'Astra 28.2 – 11597 V', satellite: 'Astra 28.2°E', frequency: 11597, polarisation: 'V', symbol_rate: 23000, delivery_system: 'DVBS2', fec: '2/3' },
  { name: 'Astra 28.2 – 11627 V', satellite: 'Astra 28.2°E', frequency: 11627, polarisation: 'V', symbol_rate: 23000, delivery_system: 'DVBS2', fec: '2/3' },
  { name: 'Astra 28.2 – 11641 H', satellite: 'Astra 28.2°E', frequency: 11641, polarisation: 'H', symbol_rate: 23000, delivery_system: 'DVBS2', fec: '2/3' },
  { name: 'Astra 28.2 – 11656 V', satellite: 'Astra 28.2°E', frequency: 11656, polarisation: 'V', symbol_rate: 22000, delivery_system: 'DVBS', fec: '5/6' },
  { name: 'Astra 28.2 – 11671 H', satellite: 'Astra 28.2°E', frequency: 11671, polarisation: 'H', symbol_rate: 23000, delivery_system: 'DVBS2', fec: '2/3' },
  { name: 'Astra 28.2 – 11686 V', satellite: 'Astra 28.2°E', frequency: 11686, polarisation: 'V', symbol_rate: 23000, delivery_system: 'DVBS2', fec: '2/3' },
  { name: 'Astra 28.2 – 11758 H', satellite: 'Astra 28.2°E', frequency: 11758, polarisation: 'H', symbol_rate: 27500, delivery_system: 'DVBS2', fec: '2/3' },
  { name: 'Astra 28.2 – 12012 V', satellite: 'Astra 28.2°E', frequency: 12012, polarisation: 'V', symbol_rate: 27500, delivery_system: 'DVBS2', fec: '2/3' },
  { name: 'Astra 28.2 – 12032 H', satellite: 'Astra 28.2°E', frequency: 12032, polarisation: 'H', symbol_rate: 29500, delivery_system: 'DVBS2', fec: '2/3' },
  { name: 'Astra 28.2 – 12129 V', satellite: 'Astra 28.2°E', frequency: 12129, polarisation: 'V', symbol_rate: 27500, delivery_system: 'DVBS2', fec: '2/3' },
  { name: 'Astra 28.2 – 12168 V', satellite: 'Astra 28.2°E', frequency: 12168, polarisation: 'V', symbol_rate: 27500, delivery_system: 'DVBS2', fec: '2/3' },
  { name: 'Astra 28.2 – 12226 H', satellite: 'Astra 28.2°E', frequency: 12226, polarisation: 'H', symbol_rate: 27500, delivery_system: 'DVBS2', fec: '2/3' },
  { name: 'Astra 28.2 – 12363 V', satellite: 'Astra 28.2°E', frequency: 12363, polarisation: 'V', symbol_rate: 27500, delivery_system: 'DVBS2', fec: '2/3' },
  { name: 'Astra 28.2 – 12382 H', satellite: 'Astra 28.2°E', frequency: 12382, polarisation: 'H', symbol_rate: 29500, delivery_system: 'DVBS2', fec: '2/3' },

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
