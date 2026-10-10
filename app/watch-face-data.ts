import type { FaceId } from '@/lib/watch-faces';

// The free Bezel Auth faces the Connect IQ developer page lists. The board's
// Bezel Auth entry says the same count in words.
export const bezelFaces = {
  count: 20,
  inWords: 'twenty',
  page: 'https://apps.garmin.com/developer/9547a1e5-162b-494c-8a14-024066f4f32f/apps',
};

// Six of them, drawn live by a port of their own Monkey C views. Each line is
// the first sentence of the face's store listing; each link is its own public
// listing.
export const watchFaces: {
  id: FaceId;
  name: string;
  line: string;
  url: string;
}[] = [
  {
    id: 'summit',
    name: 'Summit',
    line: 'An orange-accented alpine dial with mountain artwork and an easy-to-read digital clock.',
    url: 'https://apps.garmin.com/apps/be48c511-83eb-4419-bf1a-d1e60f2dba97',
  },
  {
    id: 'atelier',
    name: 'Atelier',
    line: 'A warm ivory analog dial with restrained, classic typography.',
    url: 'https://apps.garmin.com/apps/2740542f-a5a7-4cfe-80bd-aa682a3067f6',
  },
  {
    id: 'tactical',
    name: 'Tactical',
    line: 'A dark amber digital dial with a bold clock and activity details.',
    url: 'https://apps.garmin.com/apps/35390776-27da-4b79-a8e3-c1c27d0332cc',
  },
  {
    id: 'chrono',
    name: 'Chrono',
    line: 'An instrument-inspired analog dial with three compact data subdials.',
    url: 'https://apps.garmin.com/apps/72d55332-6542-403b-b9f8-3e2fb0f0db41',
  },
  {
    id: 'orbit',
    name: 'Orbit',
    line: 'A digital clock surrounded by colorful activity arcs.',
    url: 'https://apps.garmin.com/apps/02f944dd-44ef-43b2-a0ca-51f30b9dcb7e',
  },
  {
    id: 'words',
    name: 'Words',
    line: 'A typographic word clock that tells the time in five-minute phrases.',
    url: 'https://apps.garmin.com/apps/3e024916-30a3-4811-8b53-1c92b7d58b13',
  },
];
