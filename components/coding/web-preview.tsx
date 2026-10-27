"use client";

import { useEffect, useImperativeHandle, useRef, useState, type Ref } from "react";

import {
  FRAME_SANDBOX,
  previewHtml,
  type WebCheckResult,
} from "@/lib/coding/sandbox";
import type { WebCheck } from "@/lib/coding/types";
import { cn } from "@/lib/utils";

export type WebFiles = { html: string; css: string; js: string };

export type WebPreviewHandle = {
  /** Shows exactly these files, waits for the page to load and runs the checks on it. */
  check: (checks: WebCheck[], files: WebFiles) => Promise<WebCheckResult[]>;
};

type PreviewMessage =
  | { lingo: "preview"; type: "ready" }
  | { lingo: "preview"; type: "console"; stream: "stdout" | "stderr"; text: string }
  | { lingo: "preview"; type: "error"; message: string; line: number }
  | { lingo: "preview"; type: "checks"; id: number; results: WebCheckResult[] };

type WebPreviewProps = {
  files: WebFiles;
  onConsole?: (stream: "stdout" | "stderr", text: string) => void;
  onError?: (message: string, line: number) => void;
  /** Called when a new version of the page starts loading. */
  onReload?: () => void;
  /** Wait after the last change before the page re-renders. */
  delayMs?: number;
  className?: string;
  ref?: Ref<WebPreviewHandle>;
};

const ANSWER_LIMIT_MS = 5_000;
let nextCheckId = 1;

// The live preview of a web program (sections 4.2 and 4.4): a sandboxed frame with an opaque
// origin and no network access, re-rendered a moment after typing stops.
export const WebPreview = ({
  files,
  onConsole,
  onError,
  onReload,
  delayMs = 500,
  className,
  ref,
}: WebPreviewProps) => {
  const frame = useRef<HTMLIFrameElement>(null);
  const doc = previewHtml(files);
  const [shown, setShown] = useState(doc);
  const loaded = useRef<string | null>(null);
  const shownRef = useRef(shown);
  const waiting = useRef<((ok: boolean) => void)[]>([]);
  const answers = useRef(new Map<number, (results: WebCheckResult[]) => void>());
  const handlers = useRef({ onConsole, onError, onReload });

  useEffect(() => {
    handlers.current = { onConsole, onError, onReload };
  });

  useEffect(() => {
    if (doc === shownRef.current) return;
    const timer = setTimeout(() => {
      shownRef.current = doc;
      setShown(doc);
    }, delayMs);
    return () => clearTimeout(timer);
  }, [doc, delayMs]);

  useEffect(() => {
    loaded.current = null;
    handlers.current.onReload?.();
  }, [shown]);

  useEffect(() => {
    const listen = (event: MessageEvent<PreviewMessage>) => {
      if (!frame.current || event.source !== frame.current.contentWindow) return;
      const message = event.data;
      if (!message || typeof message !== "object" || message.lingo !== "preview") return;
      if (message.type === "ready") {
        loaded.current = shownRef.current;
        for (const resolve of waiting.current.splice(0)) resolve(true);
      } else if (message.type === "console")
        handlers.current.onConsole?.(message.stream, String(message.text));
      else if (message.type === "error")
        handlers.current.onError?.(String(message.message), Number(message.line) || 0);
      else if (message.type === "checks") {
        answers.current.get(message.id)?.(Array.isArray(message.results) ? message.results : []);
        answers.current.delete(message.id);
      }
    };
    window.addEventListener("message", listen);
    return () => window.removeEventListener("message", listen);
  }, []);

  useImperativeHandle(
    ref,
    () => ({
      check: async (checks, target) => {
        const wanted = previewHtml(target);
        if (loaded.current !== wanted) {
          const ready = new Promise<boolean>((resolve) => {
            waiting.current.push(resolve);
            setTimeout(() => resolve(false), ANSWER_LIMIT_MS);
          });
          if (shownRef.current !== wanted) {
            shownRef.current = wanted;
            setShown(wanted);
          }
          await ready;
        }
        const id = nextCheckId++;
        const fail = (message: string) => checks.map(() => ({ passed: false, message }));
        const window = frame.current?.contentWindow;
        if (!window) return fail("The preview is not available.");
        return new Promise<WebCheckResult[]>((resolve) => {
          const timer = setTimeout(() => {
            answers.current.delete(id);
            resolve(fail("The page did not answer. Is a script stuck in a loop?"));
          }, ANSWER_LIMIT_MS);
          answers.current.set(id, (results) => {
            clearTimeout(timer);
            resolve(results);
          });
          window.postMessage({ lingo: "check", id, checks }, "*");
        });
      },
    }),
    []
  );

  return (
    <iframe
      ref={frame}
      title="Preview of your page"
      sandbox={FRAME_SANDBOX}
      srcDoc={shown}
      className={cn("h-full w-full rounded-lg border border-slate-200 bg-white", className)}
    />
  );
};
