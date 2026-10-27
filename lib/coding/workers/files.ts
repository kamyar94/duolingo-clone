// Runtime files for code running in the sandbox. The runner frame has an opaque origin and a
// policy without network access, so it asks the app page for files (by path under /runtimes/),
// and its workers ask the frame in turn. Answers carry an ArrayBuffer.
import type { FileAnswer } from "./protocol";

export type FileBridge = {
  /** The file's bytes; each path is requested once and then kept. */
  get: (path: string) => Promise<ArrayBuffer>;
  /** Hands an answer to the request it belongs to. */
  answer: (message: FileAnswer) => void;
};

export const createFileBridge = (ask: (id: number, path: string) => void): FileBridge => {
  let nextId = 1;
  const waiting = new Map<number, { resolve: (b: ArrayBuffer) => void; reject: (e: Error) => void }>();
  const files = new Map<string, Promise<ArrayBuffer>>();
  return {
    get: (path) => {
      let file = files.get(path);
      if (!file) {
        file = new Promise<ArrayBuffer>((resolve, reject) => {
          const id = nextId++;
          waiting.set(id, { resolve, reject });
          ask(id, path);
        });
        file.catch(() => files.delete(path));
        files.set(path, file);
      }
      return file;
    },
    answer: ({ id, buffer, error }) => {
      const request = waiting.get(id);
      if (!request) return;
      waiting.delete(id);
      if (buffer) request.resolve(buffer);
      else request.reject(new Error(error ?? "The file could not be loaded."));
    },
  };
};

export const blobUrlOf = (buffer: ArrayBuffer, type: string) =>
  URL.createObjectURL(new Blob([buffer], { type }));

export const textOf = (buffer: ArrayBuffer) => new TextDecoder().decode(buffer);
