'use strict';

const BASE_URL = 'https://api.open-meteo.com/v1/forecast';

const WMO_DESCRIPTIONS = {
  0: 'Helder',
  1: 'Overwegend helder',
  2: 'Gedeeltelijk bewolkt',
  3: 'Bewolkt',
  45: 'Mist',
  48: 'Rijpmist',
  51: 'Lichte motregen',
  53: 'Matige motregen',
  55: 'Zware motregen',
  61: 'Lichte regen',
  63: 'Matige regen',
  65: 'Zware regen',
  66: 'Lichte ijsregen',
  67: 'Zware ijsregen',
  71: 'Lichte sneeuwval',
  73: 'Matige sneeuwval',
  75: 'Zware sneeuwval',
  77: 'Sneeuwkorrels',
  80: 'Lichte buien',
  81: 'Matige buien',
  82: 'Zware buien',
  85: 'Lichte sneeuwbuien',
  86: 'Zware sneeuwbuien',
  95: 'Onweer',
  96: 'Onweer met hagel',
  99: 'Zwaar onweer met hagel'
};

function describeWmo(code) {
  return WMO_DESCRIPTIONS[code] || `WMO ${code}`;
}

function getConfig() {
  const fs = require('fs');
  const path = require('path');
  try {
    const cfg = JSON.parse(fs.readFileSync(path.join(__dirname, '..', 'config.json'), 'utf8'));
    return cfg.weather || {};
  } catch {
    return {};
  }
}

/**
 * Fetch current weather conditions from Open-Meteo.
 * @param {object} options - Override latitude/longitude/timezone from config
 */
async function getCurrentWeather(options = {}) {
  const cfg = { ...getConfig(), ...options };
  const lat = cfg.latitude ?? 52.3676;
  const lon = cfg.longitude ?? 4.9041;
  const tz = encodeURIComponent(cfg.timezone || 'Europe/Amsterdam');

  const params = [
    `latitude=${lat}`,
    `longitude=${lon}`,
    `current=temperature_2m,relative_humidity_2m,precipitation,rain,snowfall,cloud_cover,wind_speed_10m,wind_direction_10m,weather_code`,
    `timezone=${tz}`,
    `forecast_days=1`
  ].join('&');

  const url = `${BASE_URL}?${params}`;
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), 10000);

  let data;
  try {
    const resp = await fetch(url, { signal: controller.signal });
    if (!resp.ok) {
      throw new Error(`Open-Meteo HTTP ${resp.status}`);
    }
    data = await resp.json();
  } finally {
    clearTimeout(timer);
  }

  const cur = data.current || {};
  const units = data.current_units || {};
  const code = cur.weather_code ?? null;

  return {
    temperature: cur.temperature_2m ?? null,
    temperature_unit: units.temperature_2m || '°C',
    humidity: cur.relative_humidity_2m ?? null,
    precipitation: cur.precipitation ?? null,
    rain: cur.rain ?? null,
    snowfall: cur.snowfall ?? null,
    cloud_cover: cur.cloud_cover ?? null,
    wind_speed: cur.wind_speed_10m ?? null,
    wind_direction: cur.wind_direction_10m ?? null,
    weather_code: code,
    weather_description: code !== null ? describeWmo(code) : null,
    time: cur.time || null,
    latitude: lat,
    longitude: lon
  };
}

module.exports = { getCurrentWeather, describeWmo };
