"use client";

// Draft autosave for a math problem (section 5.2): the strokes and the answer box are saved
// per account and challenge in challenge_drafts while the learner writes, and a copy is kept in
// this browser, so a reload or a lost connection loses nothing. The newer copy wins on return.
import { useCallback, useEffect, useRef, useState } from "react";

import {
  clearChallengeDraft,
  getChallengeDraft,
  saveChallengeDraft,
} from "@/actions/challenge-drafts";
import { thinStroke, validateStrokes } from "@/lib/math/strokes";
import type { StoredStroke } from "@/lib/math/types";

export type AnswerState = {
  /** "type": the math field or the choices; "last-line": the last line of the writing. */
  mode: "type" | "last-line";
  latex: string;
  choices: number[];
};

export type MathDraft = {
  v: 1;
  strokes: StoredStroke[];
  answer: AnswerState;
  savedAt: number;
};

export type DraftStatus = "loading" | "idle" | "saving" | "saved" | "offline";

/** Server action bodies are capped at 1 MB; drafts at 900 KB. Stay below with room to spare. */
const SERVER_LIMIT = 850 * 1024;
const SERVER_DELAY = 1500;

const localKey = (challengeId: number) => `lingo-math-draft:${challengeId}`;

const readLocal = (challengeId: number): MathDraft | null => {
  try {
    const raw = window.localStorage.getItem(localKey(challengeId));
    return raw ? parseDraft(JSON.parse(raw)) : null;
  } catch {
    return null;
  }
};

const writeLocal = (challengeId: number, draft: MathDraft | null) => {
  try {
    if (draft) window.localStorage.setItem(localKey(challengeId), JSON.stringify(draft));
    else window.localStorage.removeItem(localKey(challengeId));
  } catch {
    // Storage full or blocked: the server copy still counts.
  }
};

export const parseDraft = (value: unknown): MathDraft | null => {
  if (typeof value !== "object" || value === null) return null;
  const draft = value as Partial<MathDraft>;
  if (draft.v !== 1) return null;
  const strokes = validateStrokes(draft.strokes);
  if (!strokes.ok) return null;
  const answer = draft.answer;
  return {
    v: 1,
    strokes: strokes.strokes,
    answer: {
      mode: answer?.mode === "last-line" ? "last-line" : "type",
      latex: typeof answer?.latex === "string" ? answer.latex.slice(0, 600) : "",
      choices: Array.isArray(answer?.choices)
        ? answer.choices.filter((n): n is number => Number.isInteger(n))
        : [],
    },
    savedAt: typeof draft.savedAt === "number" ? draft.savedAt : 0,
  };
};

/** A copy small enough for a server action: points are thinned until it fits. */
export const fitDraft = (draft: MathDraft, limit = SERVER_LIMIT): MathDraft | null => {
  let current = draft;
  for (let round = 0; round < 6; round += 1) {
    if (new TextEncoder().encode(JSON.stringify(current)).length <= limit) return current;
    current = { ...current, strokes: current.strokes.map(thinStroke) };
  }
  return null;
};

export const useMathDraft = (
  challengeId: number,
  content: { strokes: StoredStroke[]; answer: AnswerState },
  onRestore: (draft: MathDraft) => void
) => {
  const [status, setStatus] = useState<DraftStatus>("loading");
  const restored = useRef(false);
  const lastSaved = useRef("");
  const timer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const unsaved = useRef<MathDraft | null>(null);
  const onRestoreRef = useRef(onRestore);
  useEffect(() => {
    onRestoreRef.current = onRestore;
  });

  // Restore once: the newer of the server draft and this browser's copy.
  useEffect(() => {
    let active = true;
    const local = readLocal(challengeId);
    getChallengeDraft(challengeId)
      .then((row) => parseDraft(row?.draft))
      .catch(() => null)
      .then((server) => {
        if (!active) return;
        const best =
          server && local ? (local.savedAt > server.savedAt ? local : server) : server ?? local;
        if (best && (best.strokes.length || best.answer.latex || best.answer.choices.length)) {
          lastSaved.current = JSON.stringify({ strokes: best.strokes, answer: best.answer });
          onRestoreRef.current(best);
        }
        restored.current = true;
        setStatus("idle");
      });
    return () => {
      active = false;
    };
  }, [challengeId]);

  const flush = useCallback(
    async (draft: MathDraft) => {
      const fitted = fitDraft(draft);
      if (!fitted) {
        setStatus("offline");
        return;
      }
      setStatus("saving");
      try {
        const result = await saveChallengeDraft(challengeId, fitted);
        setStatus(result && "ok" in result ? "saved" : "offline");
      } catch {
        setStatus("offline");
      }
    },
    [challengeId]
  );

  // Save after each change: this browser at once, the server after a pause in the writing.
  useEffect(() => {
    if (!restored.current) return;
    const key = JSON.stringify(content);
    if (key === lastSaved.current) return;
    lastSaved.current = key;
    const draft: MathDraft = { v: 1, ...content, savedAt: Date.now() };
    writeLocal(challengeId, draft);
    if (timer.current) clearTimeout(timer.current);
    unsaved.current = draft;
    timer.current = setTimeout(() => {
      timer.current = null;
      unsaved.current = null;
      void flush(draft);
    }, SERVER_DELAY);
  }, [challengeId, content, flush]);

  // Leaving the problem saves what is still waiting.
  useEffect(
    () => () => {
      if (timer.current) clearTimeout(timer.current);
      const draft = unsaved.current && fitDraft(unsaved.current);
      if (draft) void saveChallengeDraft(challengeId, draft).catch(() => undefined);
    },
    [challengeId]
  );

  /** Forgets the draft (after a correct answer). */
  const clear = useCallback(async () => {
    if (timer.current) clearTimeout(timer.current);
    timer.current = null;
    unsaved.current = null;
    writeLocal(challengeId, null);
    lastSaved.current = "";
    await clearChallengeDraft(challengeId).catch(() => undefined);
  }, [challengeId]);

  return { status, clear };
};
