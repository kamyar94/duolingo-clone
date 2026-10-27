// This file is needed to support autocomplete for process.env
export {};

declare global {
  namespace NodeJS {
    interface ProcessEnv {
      // Postgres connection (read by the pg library itself)
      PGHOST?: string;
      PGUSER?: string;
      PGPASSWORD?: string;
      PGDATABASE?: string;

      // public address, used to print invite links
      BASE_URL?: string;

      // sign-in settings
      SESSION_DAYS?: string;
      MAX_LOGIN_ATTEMPTS?: string;
      LOGIN_LOCK_MINUTES?: string;
      // "false" only for a test without https
      COOKIE_SECURE?: string;

      // folder with your own pictures, audio and video for courses (served at /media/...)
      MEDIA_DIR?: string;

      // AI features: key that encrypts learners' API keys (base64 of 32 bytes), egress proxy,
      // per-account limits, request timeout and base URL overrides for tests (lib/ai)
      LINGO_SECRET_KEY?: string;
      AI_PROXY_URL?: string;
      AI_RATE_PER_MINUTE?: string;
      AI_RATE_PER_DAY?: string;
      AI_REQUEST_TIMEOUT_MS?: string;
      AI_OPENAI_BASE_URL?: string;
      AI_ANTHROPIC_BASE_URL?: string;
      AI_GOOGLE_BASE_URL?: string;

      // voice through the workstation (lib/voice): gateway address, bearer token, the gateway's
      // root certificate, models, the default voice, the folder for cached narration audio
      VOICE_URL?: string;
      VOICE_TOKEN?: string;
      VOICE_CA_FILE?: string;
      VOICE_TTS_MODEL?: string;
      VOICE_STT_MODEL?: string;
      VOICE_STT_LANGUAGE?: string;
      VOICE_DEFAULT_VOICE?: string;
      VOICE_DATA_DIR?: string;
      VOICE_CACHE_MAX_MB?: string;
      VOICE_TIMEOUT_MS?: string;
    }
  }
}
