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
- **Coding lessons and math practice** are being built in phases after
  `docs/DESIGN-coding-and-math.md`. The groundwork is in place. New challenge types render
  through an exercise registry, each account keeps its own encrypted AI keys, and an egress
  proxy is the app's only way out to the AI providers (see below). Math practice with a pen
  works now (see "Math practice" below).

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
| `LINGO_SECRET_KEY` | Base64 of 32 random bytes that encrypts the learners' AI keys (secret) |
| `AI_PROXY_URL` | HTTP proxy for AI provider requests, the egress proxy in Docker |
| `AI_RATE_PER_MINUTE`, `AI_RATE_PER_DAY` | AI requests per account (default 10 and 300) |
| `AI_REQUEST_TIMEOUT_MS` | Longest wait for one AI request (default 120000) |

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

Coding and math challenges use the types `CODE_READ`, `CODE_OUTPUT`, `CODE_FILL`,
`CODE_ORDER`, `CODE_WRITE`, `CODE_FIX`, `WEB_LIVE` and `MATH`. Each of them carries a
`payload` object with what the exercise needs, such as the language, starter code and tests of a
coding task or the answer of a math problem, and may leave out `options`. The payload format
of each type is described with the feature that uses it, and `check`, `import` and `update`
refuse a payload that does not match. `update` replaces payloads in place like the other texts.
Outside Docker the server tool needs tsx, because the payload checks are TypeScript, so run it
as `pnpm exec tsx scripts/lingo.mjs <command>`.

## Math practice

A `MATH` challenge shows its statement with the math typeset by KaTeX, an optional figure, a
writing canvas and an answer box. The learner works the problem by hand with a pen, a finger or
the mouse and then presses Submit. The handwriting is sent as a picture to the provider and
model the learner chose for recognition, and the lines come back as LaTeX in editable math
fields, so a misread symbol can be fixed without another AI call. The next Check grades the
work, and the lesson counts the result for hearts and points like any other answer. The
example course `courses/math-demo.json` has one problem of each answer kind that the automatic
check covers.

```json
{
  "type": "MATH",
  "question": "A cyclist rides 120 m at 12 m/s. How long does the ride take?",
  "payload": {
    "statement": "A cyclist rides $120\\,\\mathrm{m}$ at $12\\,\\mathrm{m/s}$. How long does the ride take?",
    "figure": { "src": "/media/cyclist.svg", "alt": "A cyclist on a straight road" },
    "answer": { "kind": "numeric", "value": 10, "unit": "s", "tolerance": 0.01 },
    "solution": ["t = \\frac{d}{v}", "t = \\frac{120}{12} = 10\\,\\mathrm{s}"]
  }
}
```

- `statement` (optional) is the problem text with math between dollar signs. Without it the
  question is shown.
- `figure` (optional) is a picture on this site, usually `/media/<file name>`, with an `alt`
  text, an optional `caption` and an optional display `width` in pixels.
- `answer` says how the final answer is checked. The kind `numeric` takes a `value` (a number,
  or LaTeX that evaluates to one), an optional absolute `tolerance` or `relativeTolerance`, and
  an optional `unit` written like `m/s`, `km/h`, `kg*m/s^2` or `deg`. Learners may answer in any
  unit of the same kind, which is converted before comparing. The kind `expression` takes the
  expected expression or equation as LaTeX in `value` and accepts every equivalent form. The
  kind `choice` takes a list of `choices` and the index of the right one in `correct`, counted
  from 0, or a list of indexes when several must be picked. The kind `freeform` has no
  automatic check, so the AI grader judges the whole worked solution, guided by an optional
  `value` that describes a full answer.
- `solution` (optional but recommended) is the reference solution as LaTeX lines. Only the AI
  grader sees it.

The learner's browser never receives the stored answer, the tolerance or the reference
solution. Without a tolerance, a numeric answer must match up to rounding noise, so give one
whenever learners round.

Grading has two layers, and the first one decides. The Cortex Compute Engine checks the final
answer against the `answer` of the course file. The AI model then studies the steps and returns
the first wrong line, the kind of mistake, an explanation, the corrected line and a hint. When
the two disagree about the final answer, the automatic check counts and the disagreement is
kept with the attempt. Every explanation is stored under a fingerprint of the problem, its
solution version and the learner's normalised lines, so the same work submitted again is
answered from the database without an AI call. Admins see the stored explanations on
`/math-review`, with how often each was used and how often the check disagreed, and can mark
good ones as common mistakes of their problem. Learners can type follow-up questions about an
explanation, and the conversation is stored with the attempt.

The routes under `/api/math` accept requests from signed-in accounts on this site only. A
handwriting picture may be a PNG of at most 3 MB and 2048 by 8192 pixels, and a drawing at most
100,000 points. Each account may send 30 requests a minute to each math route, on top of the
AI limits below. The strokes of every attempt are kept, so the same handwriting can be read
again later with another provider.

The canvas keeps the learner's writing as a draft on the server and in the browser, so a reload
loses nothing. Once a pen touches the canvas, fingers stop drawing and pan and zoom instead,
which keeps a resting palm off the page. The page `/pen-check` shows live what a pen, a finger
or a mouse reports (pressure, tilt, buttons and samples per second), and the readings can be
copied as text. It is the quickest way to see whether a new device reports pressure.

## AI settings, keys and the egress proxy

Math practice uses an AI provider chosen by each learner, with the learner's own key. The
page `/settings/ai`, linked from the sidebar, has one key field each for OpenAI, Anthropic and
Google, a test button that sends a minimal request, a choice of provider and model for
recognition, grading and drafting, and the voice preferences for a later phase. Model names
are free text with documented defaults in `lib/ai/config.ts`, because providers retire models
over time.

Keys are encrypted with AES-256-GCM under `LINGO_SECRET_KEY` before they reach the database,
and each one is bound to its account and provider. The browser never receives a saved key
again, only its last four characters, and nothing logs keys or request bodies. Every request
records its token counts in `ai_usage`, which the settings page sums up for the last 30 days.
Requests are limited per account by `AI_RATE_PER_MINUTE` and `AI_RATE_PER_DAY`. Losing
`LINGO_SECRET_KEY` makes the saved keys unreadable, so keep a copy of it with the backups.

The app container still has no route to the internet. Provider requests go through an egress
proxy, a Squid container that accepts HTTPS tunnels to `api.openai.com`, `api.anthropic.com`
and `generativelanguage.googleapis.com` and refuses every other destination. The app reaches it
through `AI_PROXY_URL`, and the provider adapters in `lib/ai` send requests through undici's
ProxyAgent, since Node's own fetch ignores proxy variables. `deploy/` has the compose file,
the proxy allowlist, templates for every settings file and a README that explains each service.

## Tests

`pnpm test` runs the unit tests with Vitest. The tests under `tests/db` also run migrations,
course imports and the AI service against a real Postgres when `LINGO_TEST_PG_URL` names a
server where the test user may create databases, for example
`postgres://lingo:secret@127.0.0.1:5432/postgres`. They create their own databases and drop
them afterwards.

`tests/e2e/math-http.test.ts` runs math practice end to end over HTTP against the production
build. It starts the standalone server with a provider mock, signs a test account in, posts
strokes, grades the read lines and checks that the same work is answered from the stored
analysis without a provider call. Run `pnpm build` first, then the tests with `LINGO_E2E=1`
next to `LINGO_TEST_PG_URL`. The app listens on port 3102 unless `LINGO_E2E_PORT` names another.

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
