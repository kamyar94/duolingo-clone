"use client";

// The pen check page (section 5.2): shows live what a device reports through Pointer Events,
// so an S Pen, a Wacom pen, a finger or a mouse can be tested in half a minute, and the
// readings can be copied as text.
import { useCallback, useEffect, useRef, useState, useSyncExternalStore } from "react";

import { Copy, Eraser } from "lucide-react";

import { Button } from "@/components/ui/button";

import { BUTTONS, samplesOf, supportsCoalesced } from "./ink/pointer";

type Live = {
  pointerType: string;
  pointerId: number;
  isPrimary: boolean;
  pressure: number;
  tangentialPressure: number;
  tiltX: number;
  tiltY: number;
  altitudeAngle: number | null;
  azimuthAngle: number | null;
  twist: number;
  width: number;
  height: number;
  buttons: number;
  button: number;
  coalesced: number;
  predicted: number | null;
};

type Summary = {
  events: number;
  samples: number;
  pressureMin: number;
  pressureMax: number;
  tiltSeen: boolean;
  buttonsSeen: number[];
  maxCoalesced: number;
  rate: number;
  hover: boolean;
};

const emptySummary = (): Summary => ({
  events: 0,
  samples: 0,
  pressureMin: Infinity,
  pressureMax: -Infinity,
  tiltSeen: false,
  buttonsSeen: [],
  maxCoalesced: 0,
  rate: 0,
  hover: false,
});

const BUTTON_NAMES: [number, string][] = [
  [BUTTONS.primary, "contact/left"],
  [BUTTONS.barrel, "barrel/right"],
  [BUTTONS.middle, "middle"],
  [BUTTONS.back, "back"],
  [BUTTONS.forward, "forward"],
  [BUTTONS.eraser, "eraser"],
];

const buttonNames = (buttons: number) =>
  BUTTON_NAMES.filter(([bit]) => buttons & bit)
    .map(([bit, name]) => `${name} (${bit})`)
    .join(", ") || "none (0)";

const fixed = (value: number | null | undefined, digits = 3) =>
  value === null || value === undefined || Number.isNaN(value) ? "n/a" : value.toFixed(digits);

const pressureVaries = (s: Summary) =>
  s.pressureMax > s.pressureMin + 0.01 ||
  (s.samples > 0 && ![0, 0.5, 1].includes(Math.round(s.pressureMin * 1000) / 1000));

type Environment = {
  pointerEvents: boolean;
  coalesced: boolean;
  predicted: boolean;
  maxTouchPoints: number;
  pixelRatio: number;
  screen: string;
  userAgent: string;
};

let environmentSnapshot: Environment | null = null;

/** What the browser offers; read once in the browser, null while rendering on the server. */
const readEnvironment = (): Environment =>
  (environmentSnapshot ??= {
    pointerEvents: typeof PointerEvent !== "undefined",
    coalesced: supportsCoalesced(),
    predicted:
      typeof PointerEvent !== "undefined" &&
      typeof PointerEvent.prototype.getPredictedEvents === "function",
    maxTouchPoints: navigator.maxTouchPoints ?? 0,
    pixelRatio: window.devicePixelRatio || 1,
    screen: `${window.screen.width} x ${window.screen.height}`,
    userAgent: navigator.userAgent,
  });

const noChanges = () => () => undefined;

export const PenCheck = () => {
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const [live, setLive] = useState<Live | null>(null);
  const [summaries, setSummaries] = useState<Record<string, Summary>>({});
  const environment = useSyncExternalStore(noChanges, readEnvironment, () => null);
  const [copied, setCopied] = useState(false);

  const store = useRef({ live: null as Live | null, summaries: {} as Record<string, Summary> });
  const times = useRef<Record<string, number[]>>({});
  const last = useRef(new Map<number, { x: number; y: number }>());
  const frame = useRef(0);

  const publish = useCallback(() => {
    if (frame.current) return;
    frame.current = requestAnimationFrame(() => {
      frame.current = 0;
      setLive(store.current.live);
      setSummaries({ ...store.current.summaries });
    });
  }, []);


  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;
    const ctx = canvas.getContext("2d");
    const resize = () => {
      const dpr = window.devicePixelRatio || 1;
      canvas.width = Math.round(canvas.clientWidth * dpr);
      canvas.height = Math.round(canvas.clientHeight * dpr);
      ctx?.setTransform(dpr, 0, 0, dpr, 0, 0);
    };
    resize();
    const observer = new ResizeObserver(resize);
    observer.observe(canvas);

    const record = (event: PointerEvent) => {
      const samples = event.type === "pointermove" ? samplesOf(event) : [event];
      const predicted =
        typeof event.getPredictedEvents === "function" ? event.getPredictedEvents().length : null;
      const summary = (store.current.summaries[event.pointerType] ??= emptySummary());
      summary.events += 1;
      const touching = event.buttons !== 0 || event.type === "pointerdown";
      if (!touching) summary.hover = true;
      summary.maxCoalesced = Math.max(summary.maxCoalesced, samples.length);
      if (event.buttons && !summary.buttonsSeen.includes(event.buttons))
        summary.buttonsSeen = [...summary.buttonsSeen, event.buttons].sort((a, b) => a - b);
      if (event.tiltX || event.tiltY) summary.tiltSeen = true;

      const rect = canvas.getBoundingClientRect();
      const stamps = (times.current[event.pointerType] ??= []);
      for (const sample of samples) {
        stamps.push(sample.timeStamp);
        if (!touching) continue;
        summary.samples += 1;
        summary.pressureMin = Math.min(summary.pressureMin, sample.pressure);
        summary.pressureMax = Math.max(summary.pressureMax, sample.pressure);
        // A trace whose width follows the pressure.
        const x = sample.clientX - rect.left;
        const y = sample.clientY - rect.top;
        const from = last.current.get(event.pointerId) ?? { x, y };
        if (ctx) {
          ctx.strokeStyle = event.pointerType === "pen" ? "#2563eb" : event.pointerType === "touch" ? "#16a34a" : "#1f2937";
          ctx.lineCap = "round";
          ctx.lineWidth = 1 + sample.pressure * 10;
          ctx.beginPath();
          ctx.moveTo(from.x, from.y);
          ctx.lineTo(x, y);
          ctx.stroke();
        }
        last.current.set(event.pointerId, { x, y });
      }
      // Samples per second over the last second.
      const now = stamps[stamps.length - 1];
      while (stamps.length && now - stamps[0] > 1000) stamps.shift();
      if (stamps.length > 1)
        summary.rate = ((stamps.length - 1) * 1000) / Math.max(1, now - stamps[0]);

      const e = event as PointerEvent & { altitudeAngle?: number; azimuthAngle?: number };
      store.current.live = {
        pointerType: event.pointerType,
        pointerId: event.pointerId,
        isPrimary: event.isPrimary,
        pressure: event.pressure,
        tangentialPressure: event.tangentialPressure,
        tiltX: event.tiltX,
        tiltY: event.tiltY,
        altitudeAngle: typeof e.altitudeAngle === "number" ? e.altitudeAngle : null,
        azimuthAngle: typeof e.azimuthAngle === "number" ? e.azimuthAngle : null,
        twist: event.twist,
        width: event.width,
        height: event.height,
        buttons: event.buttons,
        button: event.button,
        coalesced: samples.length,
        predicted,
      };
      publish();
    };

    const onDown = (event: PointerEvent) => {
      try {
        canvas.setPointerCapture(event.pointerId);
      } catch {
        // An ended pointer cannot be captured; the readings still arrive.
      }
      last.current.delete(event.pointerId);
      record(event);
      event.preventDefault();
    };
    const onUp = (event: PointerEvent) => {
      last.current.delete(event.pointerId);
      record(event);
    };
    const prevent = (event: Event) => event.preventDefault();

    canvas.addEventListener("pointerdown", onDown);
    canvas.addEventListener("pointermove", record);
    canvas.addEventListener("pointerup", onUp);
    canvas.addEventListener("pointercancel", onUp);
    canvas.addEventListener("contextmenu", prevent);
    return () => {
      observer.disconnect();
      canvas.removeEventListener("pointerdown", onDown);
      canvas.removeEventListener("pointermove", record);
      canvas.removeEventListener("pointerup", onUp);
      canvas.removeEventListener("pointercancel", onUp);
      canvas.removeEventListener("contextmenu", prevent);
      if (frame.current) cancelAnimationFrame(frame.current);
    };
  }, [publish]);

  const clear = () => {
    const canvas = canvasRef.current;
    canvas?.getContext("2d")?.clearRect(0, 0, canvas.width, canvas.height);
    store.current = { live: null, summaries: {} };
    times.current = {};
    setLive(null);
    setSummaries({});
    setCopied(false);
  };

  const report = [
    "Lingo pen check",
    environment &&
      `Browser: pointer events ${environment.pointerEvents ? "yes" : "no"}, coalesced events ${environment.coalesced ? "yes" : "no"}, predicted events ${environment.predicted ? "yes" : "no"}, touch points ${environment.maxTouchPoints}, pixel ratio ${environment.pixelRatio}, screen ${environment.screen}`,
    environment && `User agent: ${environment.userAgent}`,
    ...Object.entries(summaries).map(
      ([type, s]) =>
        `${type}: ${s.events} events, ${s.samples} samples while touching, pressure ${fixed(s.pressureMin === Infinity ? null : s.pressureMin)} to ${fixed(s.pressureMax === -Infinity ? null : s.pressureMax)} (${pressureVaries(s) ? "varies" : "constant, no pressure"}), tilt ${s.tiltSeen ? "reported" : "not reported"}, buttons seen ${s.buttonsSeen.map(buttonNames).join(" | ") || "none"}, hover ${s.hover ? "yes" : "no"}, up to ${s.maxCoalesced} coalesced samples per event, about ${Math.round(s.rate)} samples per second`
    ),
    live &&
      `Last event: ${live.pointerType} pressure ${fixed(live.pressure)} tilt ${live.tiltX}/${live.tiltY} buttons ${buttonNames(live.buttons)} coalesced ${live.coalesced}`,
  ]
    .filter(Boolean)
    .join("\n");

  const copy = async () => {
    try {
      await navigator.clipboard.writeText(report);
      setCopied(true);
    } catch {
      setCopied(false);
      document.getElementById("pen-check-report")?.focus();
    }
  };

  const rows: [string, string][] = live
    ? [
        ["Pointer type", live.pointerType],
        ["Pressure", fixed(live.pressure)],
        ["Tilt X / Y", `${live.tiltX} / ${live.tiltY}`],
        ["Altitude / azimuth", `${fixed(live.altitudeAngle, 2)} / ${fixed(live.azimuthAngle, 2)}`],
        ["Twist", String(live.twist)],
        ["Tangential pressure", fixed(live.tangentialPressure)],
        ["Contact size", `${fixed(live.width, 1)} x ${fixed(live.height, 1)}`],
        ["Buttons", buttonNames(live.buttons)],
        ["Button changed", String(live.button)],
        ["Coalesced samples", String(live.coalesced)],
        ["Predicted samples", live.predicted === null ? "n/a" : String(live.predicted)],
        ["Pointer id / primary", `${live.pointerId} / ${live.isPrimary ? "yes" : "no"}`],
      ]
    : [];

  return (
    <div className="flex flex-col gap-4 lg:flex-row">
      <div className="flex min-w-0 flex-1 flex-col gap-2">
        <canvas
          ref={canvasRef}
          className="h-[50dvh] min-h-[260px] w-full touch-none select-none rounded-xl border-2 border-slate-200 bg-white"
          aria-label="Test area: write or draw here"
        />
        <div className="flex flex-wrap gap-2">
          <Button variant="primary" size="sm" onClick={() => void copy()} className="gap-2">
            <Copy className="h-4 w-4" /> {copied ? "Copied" : "Copy readings"}
          </Button>
          <Button variant="default" size="sm" onClick={clear} className="gap-2">
            <Eraser className="h-4 w-4" /> Clear
          </Button>
        </div>
      </div>

      <div className="w-full space-y-4 text-sm lg:w-[380px]">
        <section className="rounded-xl border-2 border-slate-200 bg-white p-3">
          <h2 className="mb-2 font-bold text-neutral-700">Live</h2>
          {rows.length ? (
            <dl className="grid grid-cols-[auto_1fr] gap-x-3 gap-y-1">
              {rows.map(([name, value]) => (
                <div key={name} className="contents">
                  <dt className="text-neutral-500">{name}</dt>
                  <dd className="font-mono text-neutral-800">{value}</dd>
                </div>
              ))}
            </dl>
          ) : (
            <p className="text-neutral-500">Touch the test area with a pen, a finger or the mouse.</p>
          )}
        </section>

        <section className="rounded-xl border-2 border-slate-200 bg-white p-3">
          <h2 className="mb-2 font-bold text-neutral-700">Per pointer type</h2>
          {Object.keys(summaries).length === 0 && <p className="text-neutral-500">Nothing yet.</p>}
          <ul className="space-y-2">
            {Object.entries(summaries).map(([type, s]) => (
              <li key={type}>
                <p className="font-bold text-neutral-700">{type}</p>
                <p className="text-neutral-600">
                  Pressure {pressureVaries(s) ? "varies" : "does not vary"}
                  {s.samples
                    ? ` (${fixed(s.pressureMin)} to ${fixed(s.pressureMax)})`
                    : ""}
                  ; tilt {s.tiltSeen ? "reported" : "not reported"}; about {Math.round(s.rate)}{" "}
                  samples per second; up to {s.maxCoalesced} per event
                  {s.hover ? "; hover reported" : ""}.
                </p>
                {s.buttonsSeen.length > 0 && (
                  <p className="text-neutral-600">Buttons: {s.buttonsSeen.map(buttonNames).join(" | ")}</p>
                )}
              </li>
            ))}
          </ul>
        </section>

        <label className="block">
          <span className="mb-1 block font-bold text-neutral-700">Readings as text</span>
          <textarea
            id="pen-check-report"
            readOnly
            value={report}
            rows={8}
            className="w-full rounded-xl border-2 border-slate-200 bg-slate-50 p-2 font-mono text-xs"
          />
        </label>
      </div>
    </div>
  );
};
