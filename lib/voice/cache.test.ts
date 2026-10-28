import { mkdtemp, readdir, rm, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";

import { afterEach, beforeEach, describe, expect, it } from "vitest";

import { ClipCache, clipKey } from "./cache";

let dir: string;
beforeEach(async () => {
  dir = await mkdtemp(path.join(os.tmpdir(), "lingo-voice-cache-"));
});
afterEach(async () => {
  // Retries: on Windows a file that was just written can still be held open for a moment.
  await rm(dir, { recursive: true, force: true, maxRetries: 5 });
});

const input = { model: "kokoro", voice: "af_heart", speed: 1, text: "Divide both sides by v." };
const clip = (label: string, size = 100) => Buffer.from(label.padEnd(size, "."));
const pause = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms));

describe("clipKey", () => {
  it("depends on the model, the voice, the speed and the text, and on nothing else", () => {
    const key = clipKey(input);
    expect(key).toMatch(/^[0-9a-f]{64}$/);
    expect(clipKey({ ...input })).toBe(key);
    expect(clipKey({ ...input, text: "Divide both sides by t." })).not.toBe(key);
    expect(clipKey({ ...input, voice: "af_bella" })).not.toBe(key);
    expect(clipKey({ ...input, speed: 1.25 })).not.toBe(key);
    expect(clipKey({ ...input, model: "other" })).not.toBe(key);
    // No two fields can run together into the same key.
    expect(clipKey({ ...input, voice: "af", text: "_heartDivide" })).not.toBe(
      clipKey({ ...input, voice: "af_heart", text: "Divide" })
    );
  });
});

describe("ClipCache", () => {
  it("makes a clip once and serves it from the file afterwards", async () => {
    const cache = new ClipCache(dir, 1_000_000);
    const key = clipKey(input);
    let made = 0;
    const create = async () => {
      made += 1;
      return clip("first");
    };

    const first = await cache.getOrCreate(key, create);
    expect(first.created).toBe(true);
    const second = await cache.getOrCreate(key, create);
    expect(second.created).toBe(false);
    expect(second.bytes.equals(first.bytes)).toBe(true);
    expect(made).toBe(1);

    // A new cache object (a restart of the app) finds the file.
    const again = await new ClipCache(dir, 1_000_000).getOrCreate(key, create);
    expect(again.created).toBe(false);
    expect(made).toBe(1);
  });

  it("makes a new clip when the narration text changes, and keeps the old one until it ages out", async () => {
    const cache = new ClipCache(dir, 1_000_000);
    let made = 0;
    const create = (label: string) => async () => {
      made += 1;
      return clip(label);
    };
    await cache.getOrCreate(clipKey(input), create("old"));
    await cache.getOrCreate(clipKey({ ...input, text: "Divide both sides by t." }), create("new"));
    expect(made).toBe(2);
    expect((await cache.stats()).files).toBe(2);
    // The old wording still plays from its own file.
    const old = await cache.getOrCreate(clipKey(input), create("again"));
    expect(old.created).toBe(false);
    expect(old.bytes.toString()).toContain("old");
    expect(made).toBe(2);
  });

  it("shares one call between simultaneous requests for the same clip", async () => {
    const cache = new ClipCache(dir, 1_000_000);
    const key = clipKey(input);
    let made = 0;
    const create = async () => {
      made += 1;
      await pause(30);
      return clip("shared");
    };
    const results = await Promise.all([1, 2, 3, 4].map(() => cache.getOrCreate(key, create)));
    expect(made).toBe(1);
    expect(results.filter((result) => result.created)).toHaveLength(1);
    expect(new Set(results.map((result) => result.bytes.toString())).size).toBe(1);
  });

  it("does not keep a failed clip, and the next request tries again", async () => {
    const cache = new ClipCache(dir, 1_000_000);
    const key = clipKey(input);
    await expect(
      cache.getOrCreate(key, async () => {
        throw new Error("gateway away");
      })
    ).rejects.toThrow("gateway away");
    expect((await cache.stats()).files).toBe(0);
    const ok = await cache.getOrCreate(key, async () => clip("ok"));
    expect(ok.created).toBe(true);
  });

  it("leaves no temporary files behind", async () => {
    const cache = new ClipCache(dir, 1_000_000);
    await cache.getOrCreate(clipKey(input), async () => clip("x"));
    const names: string[] = [];
    for (const folder of await readdir(path.join(dir, "clips")))
      names.push(...(await readdir(path.join(dir, "clips", folder))));
    expect(names).toHaveLength(1);
    expect(names[0]).toMatch(/^[0-9a-f]{64}\.mp3$/);
  });

  it("ignores keys that are not hashes, so a path cannot be built from a request", async () => {
    const cache = new ClipCache(dir, 1_000_000);
    expect(await cache.get("../../etc/passwd")).toBeNull();
    expect(await cache.get("abc")).toBeNull();
  });

  it("deletes the least recently used clips when the folder passes its limit", async () => {
    const cache = new ClipCache(dir, 1000);
    const keys = ["a", "b", "c", "d"].map((text) => clipKey({ ...input, text }));
    // Each clip is 300 bytes: the fourth takes the folder past 1000 bytes.
    for (const [n, key] of keys.slice(0, 3).entries()) {
      await cache.getOrCreate(key, async () => clip(`clip${n}`, 300));
      await pause(15);
    }
    // Using the first clip again makes the second the oldest.
    expect(await cache.get(keys[0])).not.toBeNull();
    await pause(15);
    await cache.getOrCreate(keys[3], async () => clip("clip3", 300));
    await cache.sweep();

    expect((await cache.stats()).bytes).toBeLessThanOrEqual(900);
    expect(await cache.get(keys[1])).toBeNull();
    expect(await cache.get(keys[3])).not.toBeNull();
  });

  it("still returns the clip when the folder cannot be written", async () => {
    // The folder that should hold the clips is a file.
    const blocker = path.join(dir, "blocker");
    await writeFile(blocker, "not a folder");
    const cache = new ClipCache(blocker, 1000);
    const result = await cache.getOrCreate(clipKey(input), async () => clip("served"));
    expect(result.created).toBe(true);
    expect(result.bytes.toString()).toContain("served");
  });
});
