import { describe, it, expect } from "vitest";
import { nightMinutes, isNightAt } from "../src/domain/night.js";

// London Heathrow, used as a representative mid-latitude position.
const LONDON = { latitude: 51.47, longitude: -0.4543 };

describe("night time calculation (FOCA 2.3.4, EASA civil twilight)", () => {
  it("counts no night for a midday summer flight", () => {
    const dep = new Date(Date.UTC(2026, 5, 21, 11, 0));
    const arr = new Date(Date.UTC(2026, 5, 21, 12, 30));
    expect(nightMinutes(dep, arr, LONDON)).toBe(0);
  });

  it("counts a late-evening winter flight as all night", () => {
    const dep = new Date(Date.UTC(2026, 11, 21, 22, 0));
    const arr = new Date(Date.UTC(2026, 11, 21, 23, 0));
    expect(nightMinutes(dep, arr, LONDON)).toBe(60);
  });

  it("counts only the portion after dusk for a flight crossing into night", () => {
    // Winter dusk in London is around 16:30 UTC; an hour from 16:00 to 17:00 is
    // part day, part night, so night is greater than 0 and less than the hour.
    const dep = new Date(Date.UTC(2026, 11, 21, 16, 0));
    const arr = new Date(Date.UTC(2026, 11, 21, 17, 0));
    const n = nightMinutes(dep, arr, LONDON);
    expect(n).toBeGreaterThan(0);
    expect(n).toBeLessThan(60);
  });

  it("returns zero when no position is known", () => {
    const dep = new Date(Date.UTC(2026, 11, 21, 22, 0));
    const arr = new Date(Date.UTC(2026, 11, 21, 23, 0));
    expect(nightMinutes(dep, arr, null)).toBe(0);
  });

  it("classifies a single instant as day or night for landing classification", () => {
    expect(isNightAt(new Date(Date.UTC(2026, 5, 21, 12, 0)), LONDON)).toBe(false); // summer midday
    expect(isNightAt(new Date(Date.UTC(2026, 11, 21, 22, 0)), LONDON)).toBe(true); // winter night
    expect(isNightAt(new Date(Date.UTC(2026, 11, 21, 22, 0)), null)).toBe(false); // unknown position
  });

  it("never reports more night than the length of the flight", () => {
    const dep = new Date(Date.UTC(2026, 0, 15, 21, 0));
    const arr = new Date(Date.UTC(2026, 0, 16, 6, 0));
    const total = (arr.getTime() - dep.getTime()) / 60_000;
    const n = nightMinutes(dep, arr, LONDON);
    expect(n).toBeGreaterThan(0);
    expect(n).toBeLessThanOrEqual(total);
  });
});
