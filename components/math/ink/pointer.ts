// What a pointer reports, read the same way by the canvas and the pen check page.

/** Pointer Events button bits (https://w3c.github.io/pointerevents/#the-buttons-property). */
export const BUTTONS = { primary: 1, barrel: 2, middle: 4, back: 8, forward: 16, eraser: 32 };

export const supportsCoalesced = () =>
  typeof PointerEvent !== "undefined" &&
  typeof PointerEvent.prototype.getCoalescedEvents === "function";

/**
 * Every sample the hardware delivered since the last event (coalesced events), or the event
 * itself where the browser does not offer them or returns none.
 */
export const samplesOf = (event: PointerEvent): PointerEvent[] => {
  if (typeof event.getCoalescedEvents !== "function") return [event];
  try {
    const samples = event.getCoalescedEvents();
    return samples.length ? samples : [event];
  } catch {
    return [event];
  }
};

/**
 * The eraser end of a pen (Wacom and other EMR pens report button 5 / the eraser bit), or a
 * pen with its barrel button held, which erases while held.
 */
export const isErasingPen = (event: PointerEvent) =>
  event.pointerType === "pen" &&
  ((event.buttons & BUTTONS.eraser) !== 0 ||
    event.button === 5 ||
    (event.buttons & BUTTONS.barrel) !== 0);

/**
 * Pressure counts as real when it varies or takes values other than the defaults of devices
 * without pressure (0.5 while pressed, 0 or 1 on some drivers).
 */
export const pressureIsReal = (min: number, max: number) =>
  max - min > 0.01 || ![0, 0.5, 1].includes(Math.round(min * 1000) / 1000);
