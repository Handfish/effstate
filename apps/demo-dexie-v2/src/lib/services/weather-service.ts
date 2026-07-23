import { Data, Effect, Schema } from "effect";

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
// Errors
// ============================================================================

export class WeatherNetworkError extends Data.TaggedError("WeatherNetworkError")<{
  readonly message: string;
}> {}

export class WeatherParseError extends Data.TaggedError("WeatherParseError")<{
  readonly message: string;
}> {}

export type WeatherError = WeatherNetworkError | WeatherParseError;

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
// Service
// ============================================================================

export class WeatherService extends Effect.Service<WeatherService>()("WeatherService", {
  effect: Effect.gen(function* () {
    yield* Effect.log("Created WeatherService");

    const getWeather = (lat: number, lon: number): Effect.Effect<Weather, WeatherError> =>
      Effect.gen(function* () {
        const url = `https://api.open-meteo.com/v1/forecast?latitude=${lat}&longitude=${lon}&current=temperature_2m,weather_code&temperature_unit=fahrenheit`;

        const response = yield* Effect.tryPromise({
          try: () => fetch(url),
          catch: (error) => new WeatherNetworkError({ message: String(error) }),
        });

        if (!response.ok) {
          return yield* Effect.fail(
            new WeatherNetworkError({ message: `HTTP ${response.status}` })
          );
        }

        const json = yield* Effect.tryPromise({
          try: () => response.json(),
          catch: (error) => new WeatherParseError({ message: String(error) }),
        });

        const parsed = yield* Schema.decodeUnknown(WeatherResponseSchema)(json).pipe(
          Effect.mapError((error) => new WeatherParseError({ message: String(error) }))
        );

        const weatherInfo = getWeatherInfo(parsed.current.weather_code);

        return {
          temperature: Math.round(parsed.current.temperature_2m),
          description: weatherInfo.description,
          icon: weatherInfo.icon,
        };
      });

    return { getWeather };
  }),
}) {}
