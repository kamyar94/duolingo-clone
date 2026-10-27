"use client";

// Loads author mode in the browser only: MathLive, Mafs and the player need the DOM.
import dynamic from "next/dynamic";

import type { AuthorEditor as AuthorEditorType } from "./author-editor";

export const AuthorLoader = dynamic<Parameters<typeof AuthorEditorType>[0]>(
  () => import("./author-editor").then((module) => module.AuthorEditor),
  {
    ssr: false,
    loading: () => <p className="py-10 text-center text-sm text-neutral-400">Opening author mode...</p>,
  }
);
