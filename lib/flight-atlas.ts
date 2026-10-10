import type { LogAirport } from './personal-flight-log';

export type FlightAtlas = {
  /** When the Flighty export behind it was imported, as the logbook prints
   * it (13 SEP 2026). */
  imported: string;
  airports: Record<string, LogAirport>;
  airlines: Record<string, { name: string; logo: string }>;
  years: string[];
  periods: Record<
    string,
    {
      stats: {
        flights: number;
        airports: number;
        countries: number;
        miles: number;
      };
      airlines: { code: string; flights: number }[];
      countryCodes: string[];
      airportCodes: string[];
      routes: string[][];
    }
  >;
};

const countryNames = new Intl.DisplayNames(['en'], { type: 'region' });
export const countryName = (code: string) => countryNames.of(code) || code;
export const countryFlag = (code: string) =>
  `/images/flags/${code.toLowerCase()}.svg`;
