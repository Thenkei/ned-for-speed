import type { BodyKind } from '../domain/types';

export interface BodyShape {
  readonly length: number;
  readonly width: number;
  /** Width of the nose / tail relative to the widest point. */
  readonly nose: number;
  readonly tail: number;
  /** Cabin extent along the car, from the centre (negative = towards the rear). */
  readonly cabinRear: number;
  readonly cabinFront: number;
}

export const BODY_SHAPES: Readonly<Record<BodyKind, BodyShape>> = {
  city: { length: 38, width: 19, nose: 0.8, tail: 0.9, cabinRear: -15, cabinFront: 7 },
  hatch: { length: 42, width: 20, nose: 0.78, tail: 0.9, cabinRear: -16, cabinFront: 7 },
  coupe: { length: 45, width: 20, nose: 0.74, tail: 0.84, cabinRear: -14, cabinFront: 6 },
  sport: { length: 46, width: 21, nose: 0.7, tail: 0.86, cabinRear: -13, cabinFront: 6 },
  muscle: { length: 50, width: 22, nose: 0.86, tail: 0.88, cabinRear: -15, cabinFront: 4 },
  super: { length: 48, width: 23, nose: 0.62, tail: 0.92, cabinRear: -9, cabinFront: 9 },
};

export interface Scrape {
  /** Position and wall tangent in the car frame, nose pointing to +X. */
  readonly x: number;
  readonly y: number;
  readonly angle: number;
  length: number;
}

/** Nearby strokes wear the same patch of paint during sustained contact. */
export function markScrape(marks: Scrape[], contact: Scrape): void {
  const existing = marks.find(mark => Math.hypot(mark.x - contact.x, mark.y - contact.y) < 3);
  if (existing) {
    existing.length = Math.min(14, Math.max(existing.length + 1, contact.length));
    return;
  }
  if (marks.length >= 16) marks.shift();
  marks.push(contact);
}
