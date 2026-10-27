import { describe, expect, it } from "vitest";

import { advanceClock } from "./use-playback";

describe("advanceClock", () => {
  it("moves the clock by the elapsed time at the chosen speed", () => {
    expect(advanceClock(2, 0.1, 1, 10, null).time).toBeCloseTo(2.1);
    expect(advanceClock(2, 0.1, 2, 10, null).time).toBeCloseTo(2.2);
    expect(advanceClock(2, 0.1, 0.5, 10, null).time).toBeCloseTo(2.05);
  });

  it("stops at the end, and only then is it done", () => {
    expect(advanceClock(9.95, 0.1, 1, 10, null)).toEqual({ time: 10, held: false, done: true });
    expect(advanceClock(5, 0.1, 1, 10, null).done).toBe(false);
  });

  it("does not run past a hold, which keeps a step from ending while its clip is still playing", () => {
    expect(advanceClock(3.9, 0.1, 1, 10, 3.95)).toEqual({ time: 3.95, held: true, done: false });
    // Held at the hold, it stays there however long the clip goes on.
    expect(advanceClock(3.95, 0.1, 1, 10, 3.95)).toEqual({ time: 3.95, held: true, done: false });
  });

  it("is not done while held at the very end, and finishes once the hold is released", () => {
    const held = advanceClock(9.99, 0.1, 1, 10, 9.98);
    expect(held.done).toBe(false);
    expect(held.time).toBe(9.99);
    expect(advanceClock(9.99, 0.1, 1, 10, null).done).toBe(true);
  });

  it("never moves the clock backwards when it is already past the hold", () => {
    // A jump forward (dragging) before the narration set the new hold.
    expect(advanceClock(6, 0.1, 1, 10, 3.95).time).toBe(6);
  });
});
