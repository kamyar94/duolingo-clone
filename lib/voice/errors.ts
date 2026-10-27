// Errors of the voice layer, each with the HTTP status the relay routes answer with and a
// sentence a learner can read. Messages never name the gateway address, the token or the
// certificate file.

export type VoiceErrorKind =
  /** VOICE_URL or VOICE_TOKEN is missing on this server. */
  | "not-configured"
  /** The gateway did not answer: the laptop is away, asleep, or the certificate is not trusted. */
  | "unreachable"
  | "timeout"
  /** The gateway answered but refused the request (a wrong token, for example). */
  | "rejected"
  /** The gateway or a voice container behind it failed. */
  | "upstream"
  /** The request itself is not valid (text, voice, speed, audio). */
  | "invalid"
  | "too-large"
  | "rate-limit"
  | "forbidden";

const STATUS: Record<VoiceErrorKind, number> = {
  "not-configured": 503,
  unreachable: 503,
  timeout: 503,
  rejected: 503,
  upstream: 502,
  invalid: 400,
  "too-large": 413,
  "rate-limit": 429,
  forbidden: 403,
};

const DEFAULT_MESSAGE: Record<VoiceErrorKind, string> = {
  "not-configured": "Voice is not set up on this server.",
  unreachable: "Voice is not available right now.",
  timeout: "Voice is not available right now.",
  rejected: "Voice is not available right now.",
  upstream: "The voice service could not finish that. Please try again.",
  invalid: "That request is not valid.",
  "too-large": "That is too large to send.",
  "rate-limit": "Too many voice requests in a short time. Try again shortly.",
  forbidden: "That is not allowed.",
};

export class VoiceError extends Error {
  readonly kind: VoiceErrorKind;
  readonly status: number;
  readonly retryAfter?: number;

  constructor(kind: VoiceErrorKind, message?: string, retryAfter?: number) {
    super(message ?? DEFAULT_MESSAGE[kind]);
    this.name = "VoiceError";
    this.kind = kind;
    this.status = STATUS[kind];
    this.retryAfter = retryAfter;
  }

  /** True when the voice service itself is away (as opposed to a bad request). */
  get unavailable() {
    return this.status === 503;
  }
}

export const isVoiceError = (error: unknown): error is VoiceError => error instanceof VoiceError;
