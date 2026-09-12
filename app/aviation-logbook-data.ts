export type LogbookPhoto = {
  src: string;
  alt: string;
  width: number;
  height: number;
  caption?: string;
};

export type AviationEntry = {
  id: string;
  title: string;
  kind: 'site-reference' | 'personal-entry' | 'sample';
  /** A missing personal date stays unknown; asset retrieval dates are not flight dates. */
  date: string | null;
  aircraft: string[];
  airports: { code: string; name: string }[];
  note: string;
  source: string;
  projectId?: string;
  photos: LogbookPhoto[];
};

export const aviationLogbook: AviationEntry[] = [
  {
    id: 'dreamliner-scene',
    title: 'Dreamliner / San Francisco',
    kind: 'site-reference',
    date: null,
    aircraft: ['Boeing 787-9'],
    airports: [{ code: 'SFO', name: 'San Francisco International' }],
    note: 'The Dreamliner in this site’s airborne showcase, with SFO as its home-airport reference. This is a site reference, not a record of a flight taken.',
    source: 'Personal Airspace showcase',
    projectId: 'bay-departure',
    photos: [],
  },
  {
    id: 'united-network',
    title: 'A window into the network',
    kind: 'site-reference',
    date: null,
    aircraft: ['United and United Express fleet'],
    airports: [],
    note: 'United Flight Tracker explores aircraft, fleet insights and airport operations. Aviation connects an interest in complex systems, small details and going somewhere new.',
    source: 'United Flight Tracker briefing and Flight log biography',
    projectId: 'flight-tracker',
    photos: [],
  },
];
