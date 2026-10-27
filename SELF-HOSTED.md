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
  works now, with animated solutions that authors write in the app (see "Math practice" below).

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
check covers, and three problems with animated solutions.

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

### Animated solutions

A math problem can carry an animated solution that a learner opens after a check. The player
draws every frame from a script and the position on its timeline, so dragging the handle
backwards or forwards always shows exactly the right state. The question lights up where a
given comes from, givens fly into the equations, terms that persist move from one form of an
equation to the next while new terms fade in, graphs are drawn with Mafs and figures as SVG,
and notes point at what they explain. When the check found a wrong line, the button "Watch the
solution from your mistake" opens the player at the matching step, with the learner's line
beside the correct one. Space plays or pauses, and the arrow keys move between steps.

A course file carries the script of a problem in `payload.solutionScript`. Import and update
store it in `math_solutions` as a new version, but only when it differs from the newest one,
and the challenge keeps no copy, so the lesson page never sends it to a browser. The three
problems with scripts in `courses/math-demo.json` show a cyclist's travel time, the area under
a speed graph and the Pythagorean theorem with a figure.

```json
"solutionScript": {
  "format": 1,
  "question": [{ "text": "A cyclist rides " }, { "id": "q-d", "text": "$120\\,\\mathrm{m}$" }, { "text": " at 12 m/s." }],
  "givens": [{ "id": "d", "symbol": "d", "value": 120, "unit": "m", "span": "q-d", "label": "distance" }],
  "equations": [{ "id": "motion", "states": [
    { "id": "rule", "latex": "\\term{d}{d} \\term{eq}{=} \\term{v}{v}\\,\\term{t}{t}" },
    { "id": "solved", "latex": "\\term{t}{t} \\term{eq}{=} \\frac{\\term{d}{d}}{\\term{v}{v}}" }
  ] }],
  "steps": [
    { "kind": "Extract", "given": "d", "duration": 3, "narration": "That is the distance, d." },
    { "kind": "Relate", "equation": "motion", "givens": ["d"], "duration": 3 },
    { "kind": "Transform", "equation": "motion", "to": "solved", "duration": 3 }
  ]
}
```

A script has `format` 1, the `question` split into spans, the `givens`, the `equations` with
their `states`, and optional `graphs`, `figures`, `tables` and `notes`, followed by the
`steps`. Each state is LaTeX in which terms are tagged as `\term{id}{...}`, and a term that
keeps its id in the next state moves there. Each step has a `kind` (Extract, Relate,
Substitute, Transform, Plot, Construct, Annotate or Answer), a `duration` in seconds and an
optional `narration` that shows as a subtitle. Graph functions are written in `x`, such as
`0.5*x^2`, and a small parser of their own reads them, so a script never runs code. The full
list of fields is in `lib/math/solution/types.ts`, and the check in
`lib/math/solution/validate.ts` names the field of every problem it finds.

Admins write and change solutions on `/math-author`, which lists every math problem with the
number of its versions. Selecting text in the question makes a given together with the step
that lifts it out. Equation states are typed in math fields and tagged automatically by
matching the state before, and a click on a term in one state and then on one in the next
links or unlinks the two by hand. A palette adds graph items, geometry and diagram shapes,
tables and notes, and a click on the preview places the selected one. A JSON tab edits
everything at once, and the preview beside the editor plays the script as it stands. Every save
adds a version, earlier versions stay and can be loaded again, and stored explanations keep the
version they were made against.

The button "Draft with AI" asks the author's own provider, the one chosen for drafting on
`/settings/ai`, for a first script from the question and the reference answer. The reply is
checked against the format before the editor shows it, and nothing is saved until the author
saves. Playing a solution never calls an AI provider.

Script equations are the only LaTeX that KaTeX renders with its `\htmlClass` and `\htmlId`
commands, and only with the class and id names the player itself uses. The check refuses
scripts that write these commands or link commands directly, and LaTeX from learners and from
AI replies is always rendered without them. Learners can open a solution once they have checked
or completed the problem, and authors can open every solution.

## AI settings, keys and the egress proxy

Math practice uses an AI provider chosen by each learner, with the learner's own key. The
page `/settings/ai`, linked from the sidebar, has one key field each for OpenAI, Anthropic and
Google, a test button that sends a minimal request, a choice of provider and model for
recognition, grading and drafting, and the voice preferences. Model names
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

## Voice

Lingo can read hints, explanations and the narration of animated solutions aloud, and a learner
can hold a microphone button to ask a follow-up question by voice. The speech runs on a GPU
computer on the home network, and `deploy/voice` is the stack for it, with its own README. It
has a Kokoro container for text to speech, a speaches container with a Whisper model for speech
to text, and a Caddy gateway in front of both. The gateway serves HTTPS with its own certificate
authority, wants a long random bearer token on every request, and passes only the speech and
transcription requests and two health checks. Moving the containers to the server later only
changes the gateway address.

The app reaches the gateway through the same egress proxy as the AI providers. Three settings
make the connection. `VOICE_URL` and `VOICE_TOKEN` go into the secrets file next to
`LINGO_SECRET_KEY`. `VOICE_CA_FILE` names the gateway's root certificate, which is the only
authority the app trusts for this connection. And the egress proxy allows the gateway as one
address and one port in the commented block of `squid.conf`. Optional settings are
`VOICE_STT_MODEL` and `VOICE_DEFAULT_VOICE`, and `VOICE_DATA_DIR` and `VOICE_CACHE_MAX_MB` for the
audio folder. Without `VOICE_URL` and `VOICE_TOKEN` the app shows no voice controls beyond the
browser's own voice.

Each account turns voice on, picks a voice and a speed on the settings page. The page also shows
whether the gateway answers, plays a sample, and has a switch, kept on the device, that lets the
browser's own speech synthesis read aloud when the gateway is away. Because the computer is a
laptop that sometimes sleeps, the app asks `/api/voice/status` before it shows a voice control
and hides the controls with a short note when the gateway cannot be reached. The rest of the app
works the same without voice.

The relays are `POST /api/voice/speech` for text to speech, `POST /api/voice/transcribe` for a
recording and `GET /api/voice/narration/:challengeId/:step` for the narration of one solution
step. All of them need a signed-in account and are limited per account, with a looser limit on
requests and a tighter one on clips that have to be made and recordings that have to be
transcribed. Text is limited to 3000 characters and a recording to 6 MB, and the container of a
recording is recognized from its bytes rather than from the header the browser sent. A gateway
that cannot be reached, times out or refuses the token gives a plain 503 with a short sentence
and never shows the address or the token. Formulas in a text are turned into words before they
are spoken.

Narration clips are made once. The audio of a step is stored as a file in the folder named by
`VOICE_DATA_DIR`, which is its own volume and not the read-only media folder. The file name is a
hash of the model, the voice, the speed and the spoken text, so a narration that is edited gets a
new clip on its next play and an unchanged one never reaches the GPU again, and the same holds
for hints and explanations. The oldest clips are deleted when the folder passes
`VOICE_CACHE_MAX_MB`. The solution player keeps the sound in step with the animation by
following its clock. A step starts its clip, dragging the handle starts the clip of the new step
at the matching offset, and a clip that is longer than its step holds the clock just before the
step's end until the sentence is finished.

The hold-to-talk button records in the browser, sends the recording to the transcription relay on
release and puts the words in the question field. Nothing is sent to the AI until the learner
presses send. The `Permissions-Policy` header allows the microphone for the app's own pages only.
Browsers allow the microphone only on https pages or on localhost, and the Cloudflare tunnel
provides https.

## Tests

`pnpm test` runs the unit tests with Vitest. The tests under `tests/db` also run migrations,
course imports, the AI service and the versions and AI drafts of animated solutions against a real Postgres when `LINGO_TEST_PG_URL` names a
server where the test user may create databases, for example
`postgres://lingo:secret@127.0.0.1:5432/postgres`. They create their own databases and drop
them afterwards.

`tests/e2e/math-http.test.ts` runs math practice end to end over HTTP against the production
build. It starts the standalone server with a provider mock, signs a test account in, posts
strokes, grades the read lines and checks that the same work is answered from the stored
analysis without a provider call. It also reads and saves solution versions and drafts a
script through the mock. Run `pnpm build` first, then the tests with `LINGO_E2E=1`
next to `LINGO_TEST_PG_URL`. The app listens on port 3102 unless `LINGO_E2E_PORT` names another.

`tests/e2e/voice-http.test.ts` does the same for the voice relays, with a stand-in for the
gateway that checks the bearer token. It covers sign-in and origin rules, the text and audio
limits, the cache, narration under the solution's access rule, regeneration only when the text
changes and the 503 when the gateway is away. It uses port 3112 unless `LINGO_E2E_VOICE_PORT`
names another. The unit tests in `lib/voice` also run a throwaway HTTPS gateway to check that the
certificate file is trusted and nothing else is, and they are skipped when `openssl` is missing.

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
