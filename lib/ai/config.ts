// Provider addresses and default models. The base URLs are server settings only, never taken
// from the web interface, so nobody can point the app at another address. Each can be
// overridden with an environment variable (used by tests with a local mock server); in the
// Docker stack the egress proxy allows only the three public API hosts anyway.
//
// Model names are settings each learner can change on /settings/ai. The defaults below are
// model IDs listed in each provider's public model documentation on 27 October 2026:
//   OpenAI     https://developers.openai.com/api/docs/models
//   Anthropic  https://platform.claude.com/docs/en/about-claude/models/overview
//   Google     https://ai.google.dev/gemini-api/docs/models
// Providers retire models over time, so treat them as editable starting points.
import type { AiProvider, AiTask } from "./types";

/** Environment variables, as process.env or a plain object in tests. */
export type Env = Record<string, string | undefined>;

export const DEFAULT_BASE_URLS: Record<AiProvider, string> = {
  openai: "https://api.openai.com/v1",
  anthropic: "https://api.anthropic.com",
  google: "https://generativelanguage.googleapis.com/v1beta",
};

const BASE_URL_ENV: Record<AiProvider, string> = {
  openai: "AI_OPENAI_BASE_URL",
  anthropic: "AI_ANTHROPIC_BASE_URL",
  google: "AI_GOOGLE_BASE_URL",
};

export const baseUrlFor = (
  provider: AiProvider,
  env: Env = process.env
) => (env[BASE_URL_ENV[provider]] || DEFAULT_BASE_URLS[provider]).replace(/\/+$/, "");

export const DEFAULT_MODELS: Record<AiProvider, Record<AiTask, string>> = {
  openai: {
    recognition: "gpt-6.1-sol",
    grading: "gpt-6.1-sol",
    drafting: "gpt-6.1-sol",
  },
  anthropic: {
    recognition: "claude-sonnet-5-5",
    grading: "claude-sonnet-5-5",
    drafting: "claude-sonnet-5-5",
  },
  google: {
    recognition: "gemini-3.8-flash",
    grading: "gemini-3.8-flash",
    drafting: "gemini-3.8-flash",
  },
};

/** Model names shown as suggestions next to the model fields; any other name can be typed. */
export const SUGGESTED_MODELS: Record<AiProvider, string[]> = {
  openai: ["gpt-6.1-sol", "gpt-6-astra", "gpt-6.1-terra", "gpt-6-luna"],
  anthropic: [
    "claude-sonnet-5-5",
    "claude-opus-5-5",
    "claude-haiku-5-5",
    "claude-fable-5-1",
  ],
  google: [
    "gemini-3.8-flash",
    "gemini-4-argon",
    "gemini-3.6-flash",
    "gemini-3.5-flash-lite",
  ],
};

export const DEFAULT_MAX_OUTPUT_TOKENS = 4096;

export const requestTimeoutMs = (env: Env = process.env) => {
  const value = Number(env.AI_REQUEST_TIMEOUT_MS);
  return Number.isFinite(value) && value > 0 ? value : 120_000;
};

/**
 * Model names are short identifiers (letters, digits, dot, dash, underscore and the colons of
 * fine-tuned OpenAI names); anything else is refused before it reaches a request.
 */
export const isValidModelName = (value: string) =>
  /^[A-Za-z0-9][A-Za-z0-9._:-]{0,99}$/.test(value) && !value.includes("..");
