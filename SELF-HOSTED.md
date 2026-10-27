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
  proxy is the app's only way out to the AI providers (see below). Programs in languages
  without a browser runtime run in hardened code runner containers (`runners/`).

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
| `RUNNER_TOKEN` | Shared token of the code runners, at least 24 characters (secret) |
| `RUNNER_URL_DOTNET`, `_JVM`, `_NATIVE`, `_GO`, `_RUST`, `_SCRIPT` | Address of each code runner, e.g. `http://runner-dotnet:8080` |
| `RUNNER_RATE_PER_MINUTE`, `RUNNER_RATE_PER_DAY` | Server runs per account (default 20 and 600) |

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

## Coding lessons

Coding exercises run the learner's code in one of two places. JavaScript, TypeScript, Python
(Pyodide), SQL (sql.js) and web pages run on the learner's own device, so they never touch the
server. C#, Java, Kotlin, C, C++, Go, Rust, Ruby, PHP, Perl, Lua and Bash run in Lingo's code
runners on the server, described at the end of this section. `courses/coding-demo.json` is an
example course with one exercise of each type, and `courses/server-languages-demo.json` has a
C# lesson with every type that applies plus one exercise in each other server language.

Every coding payload names its `language` (`python`, `javascript`, `typescript`, `sql`,
`csharp`, `java`, `kotlin`, `c`, `cpp`, `go`, `rust`, `ruby`, `php`, `perl`, `lua` or
`bash`) and may set
`timeLimitMs` (default 3000, at most 20000). SQL exercises add `setup`, the statements that
create and fill the tables before the learner's code runs. The import refuses unknown fields,
so a misspelt field name does not pass unnoticed. A `solution` field holds a reference answer
for authors and is never sent to the browser.

- `CODE_READ` has `code` and an optional `text` with the explanation. The learner runs and
  changes the program, and Check simply moves on. `editable: false` keeps the program as it is.
- `CODE_OUTPUT` has `code` and `expect`, the printed output. With `choices` (or the challenge's
  `options`) the learner picks an answer, otherwise the learner types it. Run unlocks after the
  answer is checked, since running would give it away.
- `CODE_FILL` has a `template` with each blank written as `___`, `answers` with the accepted
  text per blank and optional `distractors`. The learner taps chips or types. With `tests`
  the completed program must pass them instead of matching the answers.
- `CODE_ORDER` has the program's `lines` in the right order and optional `distractors`. In
  Python the learner also sets the indentation (`indent: false` turns that off). With `tests`
  the assembled program must pass them instead of matching the lines.
- `CODE_WRITE` and `CODE_FIX` have `tests`, an optional `starter` (required for `CODE_FIX`,
  where it is the program with the bug) and an optional `stdin` for Run.
- `WEB_LIVE` has `html`, `css`, `js` and `checks`, and may limit the editable tabs with
  `editable`.

A test is visible unless it says `"visible": false`. Visible tests show the expected and the
actual value when they fail, and hidden tests only show whether they passed. Hidden tests are
not secret, because checking happens in the browser and the page data contains them.

```json
{ "stdin": "3\n4\n", "expect": "7", "match": "normalized" }
{ "call": "area(2, 3)", "expect": "6", "visible": false }
{ "query": "SELECT count(*) FROM items", "rows": [[2]] }
{ "selector": "button.buy", "text": "Buy", "style": { "color": "white" } }
```

The first form feeds `stdin` to the program and compares what it prints with `expect`, either
exactly (`exact`, line endings and one final newline aside), after normalising spaces
(`normalized`, the default) or as a regular expression (`regex`). The second calls a function
in JavaScript, TypeScript or Python and compares the value with `expect`, which is an
expression in the same language, numbers within `tolerance`. For TypeScript exercises the call
is written in plain JavaScript. SQL tests compare `rows` (in order unless `ordered` is false) or
printed text with `expect`, taken from the learner's last result or from a `query` run after the
learner's statements. Web checks, the fourth form, look at the rendered page through a
selector, with an optional `count`, `text` (`textMatch` exact, contains or regex), `style`
(computed values, so `white` matches `rgb(255, 255, 255)`) and `attr`.

The runtimes are served by the app itself from `public/runtimes`, which
`scripts/build-runtimes.mjs` fills before `pnpm dev`, before `pnpm build` and in the Dockerfile.
It copies Pyodide, sql.js and the TypeScript compiler from `node_modules`, bundles the runner
scripts of `lib/coding/workers` and downloads the Jedi and parso wheels for Python completion
from PyPI with pinned hashes. Without network access the build continues and Python completion
stays at keywords. The folder is about 30 MB and is not committed. Browsers keep the files and
check them before each use, so the first Python exercise takes a few seconds and later ones load
from the cache.

Code runs in a hidden frame with `sandbox="allow-scripts"`, so it has its own opaque origin and
no access to the app's cookies, storage or pages. The frame's content security policy has no
network source at all. Its script is written into it under a nonce, the page hands it the
runtime files it asks for, and each program runs in a web worker that is stopped when its time
limit passes or when it prints more than 64 KB. Web exercises render in a second sandboxed
frame with the same lack of network, and their JavaScript runs when the learner presses Run or
Check, so a half-typed loop cannot freeze the page. The app's own pages add a content security
policy with `worker-src 'self' blob:`, `object-src 'none'` and `base-uri 'self'`, and
`X-Frame-Options` stays `DENY`, which frames written by the app itself are not subject to.

The editor is CodeMirror 6. Every language completes keywords, snippets and words in the file.
JavaScript and TypeScript also complete through the TypeScript language service in a worker,
and Python through Jedi inside Pyodide, after a dot or on Ctrl+Space. On a desktop and a tablet
in landscape the task, the editor and the output sit side by side with draggable dividers. On a
phone or a tablet in portrait they stack, the output opens as a sheet from the bottom, and a bar
of brackets, quotes, operators, tab and undo sits above the keyboard. Unfinished work is saved
per challenge and comes back when the learner returns.

The playground at `/playground` opens the same editor for any language, with programs saved to
the account and opened, renamed, copied and deleted there. It keeps up to 200 programs per
account, each up to 256 KB.

### Languages on the server

Programs in the server languages go from the browser to `POST /api/code/run`, which accepts
them only from signed-in accounts. The route checks the request (a server language, a program
of at most 64 KB, at most 20 inputs of at most 64 KB each, a time limit within the lesson
limits), applies a rate limit per account and allows two runs per account at a time. It then
sends the program with `RUNNER_TOKEN` to the runner of the language's family, found through
`RUNNER_URL_<FAMILY>` (`lib/coding/server`). A Check sends all inputs of an exercise in one
request, so the program compiles once and runs once per test. Server languages support the
input and output tests, visible and hidden, but not function tests.

The answer comes back as the same result a browser run gives, so the console, the line markers
in the editor and the test report work as for Python. Compiler errors and runtime errors are
read from the compiler's and the program's own output and point at their line in the learner's
file. A runner that is not set up, not running, busy or restarting gives the result
"unavailable", which the lesson treats as "cannot check now", so it never costs a heart.

The runners live in `runners/`. A small Go service (`runners/service`) receives the program,
compiles and runs it as a separate process in a fresh scratch folder, one job at a time with a
short queue, stops every process the job started when the time limit passes or the output goes
over 64 KB, and deletes everything the job wrote. Each language family has its own image, built
from the official image of its languages (`runners/dotnet`, `jvm`, `native`, `go`, `rust` and
`script`). The containers are unprivileged, without capabilities, read-only, limited in memory,
CPU and processes, and each sits on its own internal network with the app.
`deploy/README.md` explains the settings, the compose profiles that choose the runners and
the smoke test in `runners/test` that checks them.

For `pnpm dev` outside Docker, set `RUNNER_TOKEN` and the `RUNNER_URL_*` addresses of runners
the dev server can reach. Without them, server languages say that they cannot run here, and
everything else works as before.

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

The runner service has its own Go tests in `runners/service`, run with `go test ./...` (for
example inside the Go image). The smoke test of the runner containers is described in
`deploy/README.md`.

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
