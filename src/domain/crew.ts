/**
 * Augmented-crew time logging, from the FOCA "Logging of Flight Time" document,
 * section 2.3.4.
 *
 * On a flight flown by more than the minimum crew, each pilot logs only a share
 * of the block time: two thirds when the crew is augmented to three pilots, one
 * half when augmented to four. The same share applies to every category of time
 * (total time, function time, night, IFR). A normal crew of two logs the full
 * time. Landing counts are not shares and are never scaled.
 */

export type CrewSize = 2 | 3 | 4;

export function isValidCrewSize(n: number): n is CrewSize {
  return n === 2 || n === 3 || n === 4;
}

/**
 * The minutes a single pilot logs from `actual` block-or-condition minutes, given
 * the operating crew size. Computed as a single rounded division to keep the
 * floating point error to less than half a minute.
 */
export function loggedMinutes(actual: number, crewSize: CrewSize): number {
  switch (crewSize) {
    case 2:
      return actual;
    case 3:
      return Math.round((actual * 2) / 3);
    case 4:
      return Math.round(actual / 2);
  }
}
