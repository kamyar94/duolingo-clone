// Audio clips kept as files in a writable data folder (VOICE_DATA_DIR), separate from the
// read-only media folder. A clip's name is the hash of what went into it (model, voice, speed
// and the spoken text), so changing the text of a narration makes a new clip and the old one
// ages out, and the same wording for the same voice is generated only once. Concurrent requests
// for one clip share a single call to the gateway. When the folder grows past its limit the
// least recently used clips are deleted. Server only.
import { createHash, randomBytes } from "node:crypto";
import { mkdir, readdir, readFile, rename, stat, unlink, utimes, writeFile } from "node:fs/promises";
import path from "node:path";

export type ClipKeyInput = { model: string; voice: string; speed: number; text: string };

/** Bump when the way clips are made changes, so old files are not reused. */
const CLIP_FORMAT = "v1";

export const clipKey = ({ model, voice, speed, text }: ClipKeyInput) =>
  createHash("sha256")
    .update([CLIP_FORMAT, model, voice, speed.toFixed(2), text].join("\u0000"))
    .digest("hex");

const isKey = (key: string) => /^[0-9a-f]{64}$/.test(key);

export type ClipCacheStats = { files: number; bytes: number };

export class ClipCache {
  private readonly clips: string;
  private readonly inflight = new Map<string, Promise<Buffer>>();
  private writtenSinceSweep = 0;
  private swept = false;

  constructor(
    readonly dir: string,
    private readonly maxBytes: number
  ) {
    this.clips = path.join(dir, "clips");
  }

  private file(key: string) {
    return path.join(this.clips, key.slice(0, 2), `${key}.mp3`);
  }

  /** The stored clip, or null. A hit counts as use for the least-recently-used cleanup. */
  async get(key: string): Promise<Buffer | null> {
    if (!isKey(key)) return null;
    const file = this.file(key);
    try {
      const bytes = await readFile(file);
      const now = new Date();
      void utimes(file, now, now).catch(() => undefined);
      return bytes;
    } catch {
      return null;
    }
  }

  /**
   * The clip for a key: from the folder when it is there, otherwise made by `create`, stored and
   * returned. `created` tells whether this call made it. If the folder cannot be written, the
   * clip is still returned and nothing is kept.
   */
  async getOrCreate(
    key: string,
    create: () => Promise<Buffer>
  ): Promise<{ bytes: Buffer; created: boolean }> {
    const hit = await this.get(key);
    if (hit) return { bytes: hit, created: false };

    const pending = this.inflight.get(key);
    if (pending) return { bytes: await pending, created: false };

    const work = (async () => {
      const bytes = await create();
      await this.put(key, bytes).catch((error) => {
        console.warn("voice cache: could not store a clip:", error instanceof Error ? error.message : error);
      });
      return bytes;
    })();
    this.inflight.set(key, work);
    try {
      return { bytes: await work, created: true };
    } finally {
      this.inflight.delete(key);
    }
  }

  private async put(key: string, bytes: Buffer) {
    const file = this.file(key);
    await mkdir(path.dirname(file), { recursive: true });
    const temporary = `${file}.${process.pid}.${randomBytes(4).toString("hex")}.tmp`;
    try {
      await writeFile(temporary, bytes, { mode: 0o600 });
      await rename(temporary, file);
    } catch (error) {
      await unlink(temporary).catch(() => undefined);
      throw error;
    }
    this.writtenSinceSweep += bytes.length;
    if (!this.swept || this.writtenSinceSweep > this.maxBytes / 10) {
      this.swept = true;
      this.writtenSinceSweep = 0;
      await this.sweep().catch(() => undefined);
    }
  }

  private async list() {
    const files: { file: string; size: number; used: number }[] = [];
    let folders: string[] = [];
    try {
      folders = await readdir(this.clips);
    } catch {
      return files;
    }
    for (const folder of folders) {
      let names: string[] = [];
      try {
        names = await readdir(path.join(this.clips, folder));
      } catch {
        continue;
      }
      for (const name of names) {
        const file = path.join(this.clips, folder, name);
        try {
          const info = await stat(file);
          if (info.isFile()) files.push({ file, size: info.size, used: info.mtimeMs });
        } catch {
          // Removed while listing.
        }
      }
    }
    return files;
  }

  async stats(): Promise<ClipCacheStats> {
    const files = await this.list();
    return { files: files.length, bytes: files.reduce((sum, item) => sum + item.size, 0) };
  }

  /** Deletes the least recently used clips until the folder is at 90 percent of its limit. */
  async sweep(): Promise<number> {
    const files = await this.list();
    let total = files.reduce((sum, item) => sum + item.size, 0);
    if (total <= this.maxBytes) return 0;
    files.sort((a, b) => a.used - b.used);
    let removed = 0;
    for (const item of files) {
      if (total <= this.maxBytes * 0.9) break;
      try {
        await unlink(item.file);
        total -= item.size;
        removed += 1;
      } catch {
        // Already gone.
      }
    }
    return removed;
  }
}

let shared: { dir: string; max: number; cache: ClipCache } | null = null;

/** The clip cache of this process for a folder and limit. */
export const clipCacheFor = (dir: string, maxBytes: number): ClipCache => {
  if (!shared || shared.dir !== dir || shared.max !== maxBytes)
    shared = { dir, max: maxBytes, cache: new ClipCache(dir, maxBytes) };
  return shared.cache;
};
