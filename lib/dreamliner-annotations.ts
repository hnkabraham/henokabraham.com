export type TourAnnotation = {
  from: number;
  until: number;
  title: string;
  note: string;
};
export const TOUR_ANNOTATIONS: TourAnnotation[] = [
  {
    from: 0.32,
    until: 0.46,
    title: 'The heart of the Dreamliner.',
    note: 'Sculpted fan blades. A polished inlet. Every part with a purpose.',
  },
  {
    from: 0.53,
    until: 0.65,
    title: 'Built to bend.',
    note: 'Follow the sweep of the wing, all the way to its raked tip.',
  },
  {
    from: 0.74,
    until: 0.84,
    title: 'A signature in the sky.',
    note: 'Navy, a flash of orange, and a little of my own identity.',
  },
];
export const tourAnnotationAt = (p: number) =>
  TOUR_ANNOTATIONS.find((s) => p >= s.from && p < s.until) ?? null;
