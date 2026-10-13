import type { FaceId } from '@/lib/watch-faces';

// The free Bezel Auth faces the Connect IQ developer page lists; the board's
// Bezel Auth entry (flight-data.ts) takes its count and link from here.
export const bezelFaces = {
  count: 20,
  inWords: 'twenty',
  page: 'https://apps.garmin.com/developer/9547a1e5-162b-494c-8a14-024066f4f32f/apps',
};

// Three faces, drawn live by a port of their own Monkey C views: Nightwatch
// from Bezel Auth, with its optional 2FA row off as it ships, and Arcfield
// and Meridian from the newer collection, which has none. Each line is the
// first sentence of the face's store listing. A link is the face's public
// listing; Arcfield's and Meridian's (6e925c91-50ff-4570-98f1-0f218be70063
// and bf1a9c11-203e-4427-a34e-39e33794a870) were still in review on 12
// October 2026, so they have none yet.
export const watchFaces: {
  id: FaceId;
  name: string;
  line: string;
  url?: string;
}[] = [
  {
    id: 'nightwatch',
    name: 'Nightwatch',
    line: 'A periwinkle digital dial with decorative stars and a compact weather panel.',
    url: 'https://apps.garmin.com/apps/86557f6a-02a4-48b8-96c1-da5c9d0015ac',
  },
  {
    id: 'arcfield',
    name: 'Arcfield',
    line: 'Cream outlined hands, four progress arcs and layered minute tracks create a richly detailed field dial.',
  },
  {
    id: 'meridian',
    name: 'Meridian',
    line: 'An olive-toned analog dial with digital time and clean, instrument-inspired details.',
  },
];
