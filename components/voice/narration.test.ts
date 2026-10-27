// The narration controller with a fake audio element and a fake fetch: a clip starts with its
// step, a jump to another step cuts the old clip, a jump into the quiet end of a step starts
// nothing, a clip that arrives while the animation is paused waits for play, a missing voice
// server hides itself, and a clip that arrives after its step was left never starts.
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const voice = {
  enabled: true,
  useGateway: true,
  canSpeak: true,
  speed: 1,
};
const markVoiceAway = vi.fn();

vi.mock("./voice-store", () => ({
  voiceNow: () => voice,
  markVoiceAway: () => markVoiceAway(),
  useVoice: () => voice,
}));

import { NarrationController, type NarrationPhase } from "./narration";

class FakeAudio {
  static instances: FakeAudio[] = [];
  src = "";
  duration = 5;
  readyState = 4;
  currentTime = 0;
  playbackRate = 1;
  defaultPlaybackRate = 1;
  paused = true;
  playCalls = 0;
  onended: (() => void) | null = null;
  onerror: (() => void) | null = null;
  onloadedmetadata: (() => void) | null = null;
  constructor() {
    FakeAudio.instances.push(this);
  }
  async play() {
    this.paused = false;
    this.playCalls += 1;
  }
  pause() {
    this.paused = true;
  }
  removeAttribute() {
    this.src = "";
  }
}

const flush = () => new Promise((resolve) => setTimeout(resolve, 0));

type Log = { index: number; phase: NarrationPhase }[];

const make = (texts: (string | null)[], source = { kind: "saved", challengeId: 7, version: 2 } as const) => {
  const log: Log = [];
  const controller = new NarrationController({
    texts,
    source,
    onPhase: (index, phase) => log.push({ index, phase }),
  });
  return { controller, log };
};

let fetchMock: ReturnType<typeof vi.fn>;
const answer = (status = 200, body: unknown = null) =>
  status === 200
    ? new Response(new Blob(["clip"]), { status })
    : new Response(JSON.stringify(body), { status, headers: { "content-type": "application/json" } });

beforeEach(() => {
  FakeAudio.instances = [];
  voice.enabled = true;
  voice.useGateway = true;
  voice.canSpeak = true;
  markVoiceAway.mockClear();
  fetchMock = vi.fn(async () => answer());
  vi.stubGlobal("Audio", FakeAudio);
  vi.stubGlobal("fetch", fetchMock);
});
afterEach(() => {
  vi.unstubAllGlobals();
});

describe("NarrationController", () => {
  it("loads the clip of a step from the narration route, plays it and reports when it ends", async () => {
    const { controller, log } = make(["First.", "Second."]);
    await controller.play(0, 0);
    expect(fetchMock).toHaveBeenCalledWith("/api/voice/narration/7/0?version=2", { credentials: "same-origin" });
    expect(log.map((entry) => entry.phase)).toEqual(["loading", "playing"]);
    const audio = FakeAudio.instances[0];
    expect(audio.paused).toBe(false);

    audio.onended?.();
    expect(log.at(-1)).toEqual({ index: 0, phase: "idle" });
    controller.dispose();
  });

  it("uses the speech route for an author's unsaved script", async () => {
    const { controller } = make(["Draft narration."], { kind: "preview" } as never);
    await controller.play(0, 0);
    const [url, init] = fetchMock.mock.calls[0] as [string, RequestInit];
    expect(url).toBe("/api/voice/speech");
    expect(JSON.parse(String(init.body))).toEqual({ text: "Draft narration.", speed: 1 });
    controller.dispose();
  });

  it("starts nothing for a step without narration", async () => {
    const { controller, log } = make(["First.", null]);
    await controller.play(1, 0);
    expect(log).toEqual([{ index: 1, phase: "idle" }]);
    expect(fetchMock).not.toHaveBeenCalled();
    controller.dispose();
  });

  it("cuts the clip of the old step when the learner jumps to another step", async () => {
    const { controller, log } = make(["First.", "Second."]);
    await controller.play(0, 0);
    const audio = FakeAudio.instances[0];
    await controller.play(1, 0);
    expect(fetchMock).toHaveBeenCalledTimes(2);
    expect(log.filter((entry) => entry.phase === "playing").map((entry) => entry.index)).toEqual([0, 1]);
    // One audio element serves every step, so the end of the sound now belongs to the new step.
    expect(FakeAudio.instances).toHaveLength(1);
    expect(audio.currentTime).toBe(0);
    audio.onended?.();
    expect(log.at(-1)).toEqual({ index: 1, phase: "idle" });
    controller.dispose();
  });

  it("starts at the offset inside the step, and starts nothing when the offset is past the clip", async () => {
    const { controller, log } = make(["First."]);
    await controller.play(0, 2);
    const audio = FakeAudio.instances[0];
    expect(audio.currentTime).toBe(2);
    expect(audio.paused).toBe(false);

    await controller.play(0, 4.95);
    expect(log.at(-1)).toEqual({ index: 0, phase: "idle" });
    controller.dispose();
  });

  it("waits for play when the clip arrives while the animation is paused", async () => {
    const { controller, log } = make(["First."]);
    let release: (value: Response) => void = () => undefined;
    fetchMock.mockImplementationOnce(() => new Promise<Response>((resolve) => (release = resolve)));
    const starting = controller.play(0, 0);
    controller.pause();
    release(answer());
    await starting;
    await flush();
    expect(FakeAudio.instances[0]?.paused ?? true).toBe(true);
    expect(log.some((entry) => entry.phase === "playing")).toBe(false);

    controller.resume();
    await flush();
    expect(FakeAudio.instances[0].paused).toBe(false);
    expect(log.at(-1)).toEqual({ index: 0, phase: "playing" });
    controller.dispose();
  });

  it("pauses and resumes a clip that is playing", async () => {
    const { controller } = make(["First."]);
    await controller.play(0, 0);
    const audio = FakeAudio.instances[0];
    controller.pause();
    expect(audio.paused).toBe(true);
    controller.resume();
    await flush();
    expect(audio.paused).toBe(false);
    controller.dispose();
  });

  it("applies the speed to the clip, also to one that is already playing", async () => {
    const { controller } = make(["First."]);
    controller.setRate(1.5);
    await controller.play(0, 0);
    const audio = FakeAudio.instances[0];
    expect(audio.playbackRate).toBe(1.5);
    controller.setRate(2);
    expect(audio.playbackRate).toBe(2);
    controller.setRate(50);
    expect(audio.playbackRate).toBe(3);
    controller.dispose();
  });

  it("gives up quietly when the voice server is away, and tells the page", async () => {
    voice.canSpeak = false;
    fetchMock.mockImplementation(async () => answer(503, { error: "Voice is not available right now.", unavailable: true }));
    const { controller, log } = make(["First."]);
    await controller.play(0, 0);
    expect(markVoiceAway).toHaveBeenCalledTimes(1);
    expect(log.at(-1)).toEqual({ index: 0, phase: "idle" });
    expect(FakeAudio.instances.every((audio) => audio.paused)).toBe(true);
    controller.dispose();
  });

  it("does nothing when the account has voice turned off", async () => {
    voice.enabled = false;
    const { controller, log } = make(["First."]);
    await controller.play(0, 0);
    expect(fetchMock).not.toHaveBeenCalled();
    expect(log).toEqual([{ index: 0, phase: "idle" }]);
    controller.dispose();
  });

  it("does not start a clip that arrives after the step was left", async () => {
    const { controller, log } = make(["First.", "Second."]);
    let release: (value: Response) => void = () => undefined;
    fetchMock.mockImplementationOnce(() => new Promise<Response>((resolve) => (release = resolve)));
    const slow = controller.play(0, 0);
    await controller.play(1, 0);
    release(answer());
    await slow;
    await flush();
    expect(log.filter((entry) => entry.phase === "playing").map((entry) => entry.index)).toEqual([1]);
    controller.dispose();
  });

  it("fetches a clip once however often it is asked for ahead of time", async () => {
    const { controller } = make(["First.", "Second."]);
    controller.prefetch(1);
    controller.prefetch(1);
    controller.prefetch(5);
    await controller.play(1, 0);
    expect(fetchMock).toHaveBeenCalledTimes(1);
    controller.dispose();
  });
});
