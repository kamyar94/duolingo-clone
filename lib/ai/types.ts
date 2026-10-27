// Shared types of the AI layer. One provider interface (AiAdapter) with one adapter per
// provider in lib/ai/adapters. Plain data, safe to import from client components.

export const AI_PROVIDERS = ["openai", "anthropic", "google"] as const;
export type AiProvider = (typeof AI_PROVIDERS)[number];

export const AI_PROVIDER_NAMES: Record<AiProvider, string> = {
  openai: "OpenAI",
  anthropic: "Anthropic (Claude)",
  google: "Google (Gemini)",
};

/** What a request is for. Each learner picks a provider and a model per task. */
export const AI_TASKS = ["recognition", "grading", "drafting"] as const;
export type AiTask = (typeof AI_TASKS)[number];

export const AI_TASK_LABELS: Record<AiTask, { name: string; detail: string }> = {
  recognition: {
    name: "Recognition",
    detail: "Reads handwriting into LaTeX",
  },
  grading: {
    name: "Grading",
    detail: "Studies the steps of a solution and explains mistakes",
  },
  drafting: {
    name: "Drafting",
    detail: "Writes first drafts of animated solutions",
  },
};

export const isAiProvider = (value: unknown): value is AiProvider =>
  typeof value === "string" &&
  (AI_PROVIDERS as readonly string[]).includes(value);

export const isAiTask = (value: unknown): value is AiTask =>
  typeof value === "string" && (AI_TASKS as readonly string[]).includes(value);

export type AiImageType = "image/png" | "image/jpeg" | "image/webp" | "image/gif";

export type AiImage = {
  mediaType: AiImageType;
  /** Base64 of the image bytes, without a data: prefix. */
  data: string;
};

/** A JSON Schema object. Keep to what all three providers accept (see lib/ai/README.md). */
export type JsonSchema = Record<string, unknown>;

export type AiTurn = { role: "user" | "assistant"; text: string };

export type AiRequest = {
  model: string;
  /** Instructions that frame the whole conversation. */
  system?: string;
  /** Earlier turns, oldest first, for follow-up questions. */
  history?: AiTurn[];
  /** The new user message. */
  prompt: string;
  /** Pictures sent with the new message (handwriting, figures). */
  images?: AiImage[];
  /** Ask for JSON that matches this schema; the reply is parsed into AiResponse.json. */
  json?: { name: string; schema: JsonSchema };
  /** Upper bound for the reply, thinking included where the provider counts it. Default 4096. */
  maxOutputTokens?: number;
  signal?: AbortSignal;
};

export type AiUsage = { inputTokens: number; outputTokens: number };

export type AiResponse = {
  provider: AiProvider;
  model: string;
  text: string;
  /** Parsed JSON when the request asked for it. */
  json?: unknown;
  usage: AiUsage;
  /** The provider's own stop or finish reason, for diagnostics. */
  stopReason?: string;
};

export interface AiAdapter {
  readonly provider: AiProvider;
  send(request: AiRequest): Promise<AiResponse>;
}

export type AdapterOptions = {
  apiKey: string;
  /** Default: the provider's public API, or the AI_*_BASE_URL override (lib/ai/config.ts). */
  baseUrl?: string;
  /** Default: AI_REQUEST_TIMEOUT_MS or 120 seconds. */
  timeoutMs?: number;
};
