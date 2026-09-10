export type DepartureAnnotation = {
  id: string;
  from: number;
  until: number;
  title: string;
  note: string;
};

// These intervals describe the authored choreography, never flight telemetry.
export const DEPARTURE_ANNOTATIONS: DepartureAnnotation[] = [
  {
    id: 'brakes',
    from: 0.155,
    until: 0.205,
    title: 'Brake release',
    note: 'The hold gives way to the takeoff roll.',
  },
  {
    id: 'rotation',
    from: 0.36,
    until: 0.405,
    title: 'Rotation',
    note: 'The nose rises as the runway falls away.',
  },
  {
    id: 'gear',
    from: 0.48,
    until: 0.515,
    title: 'Gear retraction',
    note: 'The undercarriage folds into the airframe.',
  },
  {
    id: 'flex',
    from: 0.535,
    until: 0.57,
    title: 'Wing flex',
    note: 'The wing bends under the scene’s climb load.',
  },
  {
    id: 'san-bruno',
    from: 0.625,
    until: 0.675,
    title: 'San Bruno Mountain',
    note: 'The peninsula’s ridge, west of the departure path.',
  },
  {
    id: 'golden-gate',
    from: 0.805,
    until: 0.845,
    title: 'The Golden Gate',
    note: 'The strait opens between San Francisco and Marin.',
  },
];

export const departureAnnotationAt = (progress: number) =>
  DEPARTURE_ANNOTATIONS.find(
    (item) => progress >= item.from && progress < item.until,
  ) ?? null;
