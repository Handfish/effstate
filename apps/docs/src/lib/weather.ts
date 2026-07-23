import { Schema } from "effect";

// ============================================================================
// Types
// ============================================================================

const WeatherResponseSchema = Schema.Struct({
  current: Schema.Struct({
    temperature_2m: Schema.Number,
    weather_code: Schema.Number,
  }),
});

export interface Weather {
  readonly temperature: number;
  readonly description: string;
  readonly icon: string;
}

// ============================================================================
// Weather Code to Description
// ============================================================================

const weatherCodes: Record<number, { description: string; icon: string }> = {
  0: { description: "Clear sky", icon: "☀️" },
  1: { description: "Mainly clear", icon: "🌤️" },
  2: { description: "Partly cloudy", icon: "⛅" },
  3: { description: "Overcast", icon: "☁️" },
  45: { description: "Foggy", icon: "🌫️" },
  48: { description: "Icy fog", icon: "🌫️" },
  51: { description: "Light drizzle", icon: "🌧️" },
  53: { description: "Drizzle", icon: "🌧️" },
  55: { description: "Heavy drizzle", icon: "🌧️" },
  61: { description: "Light rain", icon: "🌧️" },
  63: { description: "Rain", icon: "🌧️" },
  65: { description: "Heavy rain", icon: "🌧️" },
  71: { description: "Light snow", icon: "🌨️" },
  73: { description: "Snow", icon: "🌨️" },
  75: { description: "Heavy snow", icon: "🌨️" },
  80: { description: "Rain showers", icon: "🌦️" },
  81: { description: "Heavy showers", icon: "🌦️" },
  82: { description: "Violent showers", icon: "⛈️" },
  95: { description: "Thunderstorm", icon: "⛈️" },
  96: { description: "Thunderstorm with hail", icon: "⛈️" },
  99: { description: "Severe thunderstorm", icon: "⛈️" },
};

const getWeatherInfo = (code: number) =>
  weatherCodes[code] ?? { description: "Unknown", icon: "❓" };

// ============================================================================
// Fetch
// ============================================================================

export async function fetchWeather(lat = 37.7749, lon = -122.4194): Promise<Weather> {
  const url = `https://api.open-meteo.com/v1/forecast?latitude=${lat}&longitude=${lon}&current=temperature_2m,weather_code&temperature_unit=fahrenheit`;

  const response = await fetch(url);
  if (!response.ok) {
    throw new Error(`HTTP ${response.status}`);
  }

  const json = await response.json();
  const parsed = Schema.decodeUnknownSync(WeatherResponseSchema)(json);
  const weatherInfo = getWeatherInfo(parsed.current.weather_code);

  return {
    temperature: Math.round(parsed.current.temperature_2m),
    description: weatherInfo.description,
    icon: weatherInfo.icon,
  };
}
