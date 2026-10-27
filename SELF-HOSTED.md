# Self-hosted Lingo

This fork of [sanidhyy/duolingo-clone](https://github.com/sanidhyy/duolingo-clone) runs the app
entirely on your own machine: its own sign-in instead of Clerk, a local Postgres instead of Neon,
and no Stripe payments. `README.md` is upstream's and still describes the original Clerk, Neon
and Stripe setup; it is left untouched so upstream changes merge cleanly. This file describes
what is different here.

## What this fork changes

- **Sign-in** is local: usernames and scrypt password hashes in Postgres, single-use invite codes
  instead of open sign-up, 30-day session cookies (only a SHA-256 of each cookie is stored), an
  account lock after repeated wrong passwords and a per-address limit (`lib/auth.ts`,
  `actions/auth.ts`, `app/(auth)/`). Clerk is removed.
- **Database** is any Postgres reached with `pg` (`db/drizzle.ts`). The schema lives in
  `drizzle/` as migrations, applied on every start by `scripts/start.mjs`.
- **Payments**: Stripe and the "Pro" upgrade are removed; nobody has unlimited hearts.
- **Courses** can be imported from JSON files and updated in place later (see below). The
  upstream Spanish seed is `courses/spanish-demo.json` and is added to a new, empty database.
- **Hints and explanations**: a question can carry a hint, opened on request, and an
  explanation shown once the answer is checked (`app/lesson/challenge-notes.tsx`). Answer options
  keep the order they were added in.
- **Own pictures and audio** are served to signed-in users from `/media/...` (`app/media/`),
  with range requests for audio.
- **Build**: standalone Next.js output in a non-root Docker image (`Dockerfile`), security
  headers, no CORS, health check at `/api/health`.

## Running it

The image expects a reachable Postgres and these environment variables:

| Variable | Meaning |
|---|---|
| `PGHOST`, `PGPORT`, `PGUSER`, `PGPASSWORD`, `PGDATABASE` | Postgres connection (standard `pg` variables) |
| `BASE_URL` | Public address, used in invite links, e.g. `https://learn.example.com` |
| `COOKIE_SECURE` | `false` only for plain-http testing; secure cookies otherwise |
| `SESSION_DAYS` | How long a sign-in lasts (default 30) |
| `MAX_LOGIN_ATTEMPTS`, `LOGIN_LOCK_MINUTES` | Account lock after wrong passwords (default 5 and 15) |
| `MEDIA_DIR` | Folder served under `/media`, mounted read-only (default `/media`) |

Keep passwords and tokens in env files that are never committed; `.gitignore` and
`.dockerignore` already exclude `.env*`. For `pnpm dev` outside Docker, copy `.env.example`.

Nobody can sign up without an invite. Accounts and courses are managed with the server tool
inside the running container:

```
docker compose exec app node scripts/lingo.mjs <command>

  invite [--note NAME] [--admin] [--days N]   single-use sign-up code (default: valid 7 days)
  reset USERNAME [--days N]                   single-use code to choose a new password
  users                                       list accounts
  unlock USERNAME                             clear a lock after too many wrong passwords
  admin USERNAME on|off                       give or take the admin screens
  disable USERNAME | enable USERNAME          block or allow an account (ends its sign-ins)
  invites                                     list codes that are still unused
  check FILE.json                             check a course file without importing it
  import FILE.json [FILE.json ...]            add courses from files
  update FILE.json [FILE.json ...]            apply changed texts to the course with the same title
```

## Course files

A course has units, a unit has lessons, a lesson has challenges, and a challenge has options with
exactly one correct. The order in the file is the order in the app.

```json
{
  "title": "Solar system (example)",
  "imageSrc": "/mascot.svg",
  "units": [
    {
      "title": "Unit 1",
      "description": "The planets",
      "lessons": [
        {
          "title": "Planets",
          "challenges": [
            {
              "type": "ASSIST",
              "question": "Which planet is the largest?",
              "hint": "It is a gas giant.",
              "explanation": "Jupiter is more than twice as massive as all other planets together.",
              "options": [
                { "text": "Jupiter", "correct": true },
                { "text": "Earth", "correct": false },
                { "text": "Mars", "correct": false }
              ]
            }
          ]
        }
      ]
    }
  ]
}
```

- `type`: `ASSIST` shows the question in a speech bubble and the answers as a numbered list;
  `SELECT` shows the question as a heading and the answers as picture cards.
- `hint`, `explanation` (optional): see above. Explanations can refer to "option 2", since
  options are numbered in file order.
- `imageSrc`, `audioSrc` (optional, per option) and the course `imageSrc`: the app's own files
  such as `/man.svg`, or your own as `/media/<file name>`.
- `import` refuses a title that already exists. `update` finds the course by title and replaces
  texts, pictures, sounds, right answers, hints and explanations in place, so progress stays;
  the units, lessons, challenges and options must match in number and order, otherwise nothing
  changes.

## Keeping up with upstream

Remotes: `origin` is this fork, `upstream` is `sanidhyy/duolingo-clone`. Upstream mostly ships
dependency bumps from Dependabot plus a bot that rewrites its README's package list.

```
git fetch upstream
git merge upstream/main
```

Typical conflicts and how to settle them:

- `package.json`: keep the packages this fork removed out (`@clerk/nextjs`,
  `@neondatabase/serverless`, `@vercel/config`, `stripe`, `dotenv`); take upstream's version
  bumps for everything else.
- `pnpm-lock.yaml`: take either side, then regenerate it with `pnpm install` and commit.
- Files this fork deleted (Clerk sign-in pages, Stripe webhook, `lib/stripe.ts`, promo banner,
  `vercel.ts`, `scripts/prod.ts`): keep them deleted with `git rm`.
- A schema change upstream needs a new migration: `pnpm exec drizzle-kit generate`.

Two GitHub settings matter for this fork:

- **Never use "Discard commits"** in GitHub's *Sync fork* menu: it throws away this fork's
  changes. Merge through a pull request or locally instead.
- **GitHub Actions stay disabled.** Upstream's `update-readme` workflow would rewrite
  `README.md` from this fork's `package.json`, and every later upstream merge would then
  conflict on it. Dependabot (`.github/dependabot.yml`) proposes this fork's own dependency
  updates as pull requests.
