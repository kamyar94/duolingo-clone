"use client";

import { useCallback, useEffect, useRef, useState } from "react";

import { getChallengeDraft, saveChallengeDraft } from "@/actions/challenge-drafts";

const SAVE_DELAY_MS = 1200;

type Stored<T> = { v: 1; data: T };

const isStored = (value: unknown): value is Stored<unknown> =>
  typeof value === "object" && value !== null && (value as { v?: unknown }).v === 1 && "data" in value;

/**
 * The learner's unfinished work on a challenge (section 4.6): restored when the exercise opens,
 * saved a moment after each change and when the exercise closes.
 */
export const useDraft = <T>(
  challengeId: number,
  initial: T,
  accept: (value: unknown) => value is T
) => {
  const [value, setValue] = useState<T>(initial);
  const [restored, setRestored] = useState(false);
  const latest = useRef<T>(initial);
  const dirty = useRef(false);
  const timer = useRef<ReturnType<typeof setTimeout> | undefined>(undefined);
  const acceptRef = useRef(accept);

  useEffect(() => {
    let cancelled = false;
    getChallengeDraft(challengeId)
      .then((row) => {
        if (cancelled || dirty.current || !row || !isStored(row.draft)) return;
        if (acceptRef.current(row.draft.data)) {
          latest.current = row.draft.data;
          setValue(row.draft.data);
        }
      })
      .catch(() => undefined)
      .finally(() => {
        if (!cancelled) setRestored(true);
      });
    return () => {
      cancelled = true;
    };
  }, [challengeId]);

  const save = useCallback(() => {
    clearTimeout(timer.current);
    if (!dirty.current) return;
    dirty.current = false;
    const draft: Stored<T> = { v: 1, data: latest.current };
    saveChallengeDraft(challengeId, draft).catch(() => undefined);
  }, [challengeId]);

  const update = useCallback(
    (next: T | ((previous: T) => T)) => {
      const resolved =
        typeof next === "function" ? (next as (previous: T) => T)(latest.current) : next;
      latest.current = resolved;
      dirty.current = true;
      setValue(resolved);
      clearTimeout(timer.current);
      timer.current = setTimeout(save, SAVE_DELAY_MS);
    },
    [save]
  );

  // Leaving the lesson or the page saves what is left.
  useEffect(() => {
    window.addEventListener("pagehide", save);
    return () => {
      window.removeEventListener("pagehide", save);
      save();
    };
  }, [save]);

  return [value, update, restored] as const;
};

export const isString = (value: unknown): value is string => typeof value === "string";

export const isStringList = (value: unknown): value is string[] =>
  Array.isArray(value) && value.every((item) => typeof item === "string");
