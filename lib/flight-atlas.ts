import type { LogAirport } from './personal-flight-log';

export type FlightAtlas = {
  airports: Record<string, LogAirport>;
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
      airportCodes: string[];
      routes: string[][];
    }
  >;
};

const countryNames = new Intl.DisplayNames(['en'], { type: 'region' });
export const countryName = (code: string) => countryNames.of(code) || code;
export const countryFlag = (code: string) =>
  `/images/flags/${code.toLowerCase()}.svg`;
