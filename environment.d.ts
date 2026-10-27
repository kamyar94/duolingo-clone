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
    }
  }
}
