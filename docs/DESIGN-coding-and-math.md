# Lingo design spec: coding lessons and math practice

Draft 1, 27 October 2026. Nothing described here is built yet. Facts about third-party tools are
checked against their own documentation and listed in section 10; anything not yet checked is
marked TBA.

## 1. Purpose

Lingo teaches today with short lessons of multiple-choice questions, each with an optional hint
and an explanation shown after the answer is checked. This spec adds two abilities so that the
same app can teach programming and mathematics with the depth of dedicated learning apps, while
staying a self-hosted service for a household.

The first ability is coding lessons in the style of Sololearn and Mimo. Short explanations
alternate with exercises that the learner types, runs and checks in a real code editor inside the
browser, with code completion, live output and automatic tests. The second ability is math
practice. The learner works a problem by hand with a pen, an AI model of the learner's choice
reads the handwriting into LaTeX, the work is compared with a stored solution, and the app explains
where it went wrong. An animated solution then shows how the quantities in the question become
variables, how the variables enter equations and how the equations are solved, step by step, with
a timeline handle that the learner can pause and drag.

Three properties of the current deployment are kept. The service stays self-hosted, with every
record in its own Postgres database. The hardening stays in place, so the app container keeps no
general internet access and gains only the narrow, allowlisted routes described in section 6. The
fork stays easy to merge with upstream, because new work lives in new files and new database
migrations only add tables and columns.

## 2. Decisions taken

The answers given on 27 October 2026 fix the scope. Each one has a direct consequence for the
design, listed here and developed in the section named in the last column.

| Topic | Decision | Consequence | Section |
|---|---|---|---|
| Coding languages | Support every common language | Two execution paths, in the browser where a WebAssembly runtime exists and in an isolated runner on the server for the rest | 4.4 |
| AI providers | OpenAI, Anthropic (Claude) and Google (Gemini), each with its own key field | One provider interface with one adapter per provider and a separate encrypted key per provider and user | 6.1 |
| Voice | Use the GPU voice containers on the workstation for now, through a safe route | A voice gateway on the workstation, reached from the server through an allowlisted, authenticated route | 6.3 |
| Devices | Phone and tablet with S Pen, and a desktop with a Wacom tablet | One ink canvas built on Pointer Events with three layouts | 5.2 |
| Range of math | All kinds, with the variety of Brilliant | A general solution script whose scenes hold equations, graphs, geometry and diagrams, and several answer types | 5.5, 5.7 |

Two further choices were settled on 27 October 2026. The server-side code runner is a hardened,
unprivileged container rather than a virtual machine (section 4.4), and the voice gateway is a
dedicated stack on the workstation rather than a door into the voice containers of other projects
(section 6.3).

## 3. Starting point

Lingo is a Next.js 16 application with React 19, the Drizzle object-relational mapper and Postgres
18. Accounts are invite-only, with scrypt password hashes, session cookies and an account lock
after repeated wrong passwords. Content is organised as courses, units, lessons and challenges. A
challenge has a type (`SELECT` or `ASSIST` today), a question, an optional hint and explanation,
and a set of options with one correct answer. Course files in JSON are imported with
`lingo.mjs import` and updated in place with `lingo.mjs update`. Pictures and audio are served to
signed-in users from a read-only media folder.

The app runs in a hardened container. It has no published ports, sits on two internal Docker
networks (one shared with the Cloudflare tunnel connector, one with the database) and has no route
to the internet. Its response headers deny framing (the `X-Frame-Options` header is `DENY`) and
deny camera and microphone access (the `Permissions-Policy` header). Both features need narrow, deliberate exceptions to
these rules, and each exception is named in section 7.

New work follows four rules so that upstream updates keep merging cleanly. Pages for the new
features live under their own route groups, logic under `lib/coding` and `lib/math`, components
under `components/coding` and `components/math`. The existing lesson flow is reused where it fits,
so hearts, points, quests and the leaderboard count the new exercises without changes. Database
changes are new tables and new nullable columns created by new migrations. Upstream files are
edited only where a hook into the existing flow is unavoidable, such as the challenge type list
and the lesson page that chooses which exercise component to show.

## 4. Coding lessons

### 4.1 What a lesson feels like

A coding lesson is a short run of cards, the same rhythm as today's lessons. A reading card
explains one idea with a small program the learner can run and change. The cards that follow ask
the learner to use the idea, first with low effort (predict the output, fill a blank, put lines in
order) and then by writing code. Every exercise can be run as often as the learner wants, and
running never costs anything. Only pressing Check can cost a heart, exactly as a wrong answer does
today, and practice rounds give hearts back.

| Type | What the learner does | How it is checked |
|---|---|---|
| `CODE_READ` | Reads an explanation and runs or edits a sample program | Not graded |
| `CODE_OUTPUT` | Predicts what a program prints, by choosing or typing | Compared with the stored output |
| `CODE_FILL` | Completes blanks in a program by tapping tokens or typing | The completed program runs against tests |
| `CODE_ORDER` | Puts shuffled lines in order, including indentation where it matters | The assembled program runs against tests |
| `CODE_WRITE` | Writes a program or function from a task description | Visible and hidden tests |
| `CODE_FIX` | Finds and repairs a bug in a given program | Visible and hidden tests |
| `WEB_LIVE` | Edits HTML, CSS and JavaScript with a live preview of the page | Checks run against the rendered page |

Outside lessons, a playground page opens the same editor for any supported language, with no task
and no grading. Programs written there are saved to the learner's account under a name and can be
reopened, copied or deleted, which gives the learner a place to experiment the way the code
playgrounds of Sololearn and Mimo do.

### 4.2 Editor and layouts

The editor is CodeMirror 6 rather than Monaco, the editor of Visual Studio Code. Monaco does not
support mobile browsers, while CodeMirror 6 works with touch screens and on-screen keyboards, is
MIT licensed, and provides syntax highlighting, autocompletion, linting and language packages as
separate modules. JavaScript, Python and SQL have full language packages. C#, Java, Kotlin and
other C-family languages are highlighted through the `clike` mode of `@codemirror/legacy-modes`.
CodeMirror's source repositories moved off GitHub to the author's own server, and its packages
are still published to npm, so the dependency is pinned and watched by Dependabot like the rest.

The layout follows the device. On a desktop and on a tablet in landscape, the task sits on the
left, the editor in the middle and the output and test results below the editor, with a
draggable divider. On a tablet in portrait and on a phone, the parts stack vertically and the
output opens as a sheet from the bottom. Phones get a symbol bar above the on-screen keyboard with
brackets, quotes, common operators, a tab key and undo, because these characters are slow to reach
on a phone keyboard. Fill and order exercises use tappable code chips on every device, so a phone
user rarely has to type to make progress.

"Real time" means three things in this design. Program output streams into the console while the
program runs. Errors and test failures are shown on the line they belong to. The web playground
re-renders its preview a short moment after the learner stops typing.

### 4.3 Code completion

Completion comes in three tiers, so that every language has some help and the most used languages
have full help. Every language gets completion of keywords, snippets and words already in the
file. JavaScript and TypeScript get real completion from the TypeScript language service running in
a web worker in the browser. Python gets real completion from the Jedi library running inside
Pyodide in the browser. Languages that run on the server can later get completion from their
language servers (the Language Server Protocol), such as a Roslyn-based server for C#, Eclipse JDT
for Java and clangd for C and C++. These servers are large, so each one is added only when a
course in that language needs it.

### 4.4 Running code

Code runs in one of two places. Languages with a WebAssembly runtime run inside the learner's
browser, which is fast, works without the server and cannot harm the server. All other languages
run in an isolated runner on the server.

| Language | Where it runs | Engine |
|---|---|---|
| JavaScript, TypeScript | Browser | A sandboxed frame with a web worker; TypeScript is transpiled in the browser |
| Python | Browser | Pyodide, CPython compiled to WebAssembly |
| SQL | Browser | sql.js, SQLite compiled to WebAssembly |
| HTML and CSS | Browser | A sandboxed frame for the live preview |
| C#, Java, C, C++, Go, Rust, Kotlin, PHP, Ruby, Bash and others | Server | Lingo's own runner containers, one per language family |

Browser runs are contained in a frame with the `sandbox` attribute and no same-origin access, and
the program itself runs in a web worker inside that frame. The frame's content security policy
blocks network access, the worker is terminated when a time limit passes, and output is capped in
size. The runtimes (Pyodide, sql.js and the TypeScript compiler) are served by Lingo itself rather
than from a public content delivery network, so lessons need no third-party downloads and keep
working if those sites change. Pyodide is the largest of them, about 12 MB for its core files
before compression, so it is loaded only when a Python exercise opens and then kept in the
browser cache.

C# can also run in the browser, because the Roslyn compiler runs on .NET compiled to WebAssembly,
as two current projects show (Microsoft's c-sharp-minor learning module and Moka.Blazor.Repl).
The download size of such a compiler in the browser is not yet confirmed and is measured before
choosing this path. If it is acceptable, short C# exercises run in the browser and only full
programs go to the server runner.

The server runner is the one part of the design that runs code written by a user on the server, so
it gets its own containers with the strictest settings of the stack. Each language family (for
example .NET for C#, the JVM for Java and Kotlin, GCC and Clang for C and C++, Go, Rust, and the
scripting languages) has a runner image built from the official image of that language, with a
small runner service inside. The service receives code from the Lingo app, compiles and runs it as
a separate process in a fresh scratch folder, kills the whole process group when the time limit
passes, caps the output, and deletes the scratch folder afterwards. The containers are not
privileged, drop every Linux capability, run as a non-root user with a read-only file system and a
small temporary folder, have limits on memory, processes and CPU, sit on a private network that
only the Lingo app reaches, and have no internet access. Runs are accepted only for signed-in users,
with a rate limit per user, and each container handles one run at a time and is restarted
regularly.

This keeps the whole stack free of privileged containers. Its limit is that the runners share the
Linux kernel with the other containers on the host, so the protection rests on the container
settings above rather than on a separate machine; a dedicated virtual machine remains a later
option if the runner is ever opened beyond the household. Two existing engines were considered and
not used. Piston needs a privileged container, and its recent commits change only its README while
its public demonstration service closed in February 2026. Judge0 is licensed under the GPL-3.0,
also needs privileged containers and has had sandbox escapes reported in 2024.

### 4.5 Checking answers

Each exercise carries a test specification. The universal form, which works for every language,
feeds an input to the program and compares its output with the expected output, exactly, after
normalising whitespace, or with a regular expression. Languages with a test harness in Lingo
(JavaScript, TypeScript and Python first) also support function tests, which call a named function
with arguments and compare the returned value. Tests are either visible, showing the expected and
actual values side by side when they fail, or hidden, showing only whether they passed. Web
exercises check the rendered page with selector queries, for example that a button with a given
label exists and has a given colour.

When a check fails, the learner sees which tests failed and why. The existing hint and explanation
fields keep working for coding exercises. An optional "Explain my error" button can later send the
code and the failing test to the learner's AI provider, using the same key and route as the math
feature.

### 4.6 Data model and course files

The challenge type list gains the seven types of section 4.1. Challenges gain one nullable
`payload` column of type `jsonb` that holds everything a coding exercise needs, so the existing
tables stay unchanged in shape. A new table `challenge_drafts` keeps the learner's last code per
challenge, so leaving a lesson and coming back restores the work.

```json
{
  "type": "CODE_WRITE",
  "question": "Write a function area(w, h) that returns the area of a rectangle.",
  "hint": "Multiply the two sides.",
  "explanation": "The area of a rectangle is width times height, so the function returns w * h.",
  "payload": {
    "language": "python",
    "starter": "def area(w, h):\n    pass\n",
    "tests": [
      { "call": "area(2, 3)", "expect": "6", "visible": true },
      { "call": "area(0.5, 4)", "expect": "2.0", "visible": false }
    ],
    "timeLimitMs": 3000
  }
}
```

The course file format, the importer and `lingo.mjs update` accept the new types and the payload.
The admin screens show the payload in a structured editor with a live preview of the exercise.

## 5. Math practice

### 5.1 What a problem feels like

A math problem shows its statement at the top, sometimes with a figure or a graph, a writing
surface below it and an answer box. The learner works the solution out by hand with an S Pen, a
Wacom pen, a finger or a mouse, then gives the final answer in the answer box, by tapping a choice,
typing in a math field, or marking the last line on the canvas as the answer. When the learner
presses Submit, the handwriting is turned into lines of LaTeX that appear as rendered formulas, and
the learner can correct a misread symbol before anything is graded.
Grading then checks the final answer and studies the steps. The learner sees whether the answer is
right, which line first went wrong, what kind of mistake it was and how to continue, and can hear
the explanation read aloud or ask a follow-up question by voice. Finally the learner can open the
animated solution, which starts at the step where the mistake happened.

### 5.2 Ink canvas

The canvas is built on Pointer Events, which deliver pen, touch and mouse input through one
interface and report the pointer type (`pen`, `touch` or `mouse`), pressure and tilt. Whether the
S Pen reports real pressure in Chrome and Samsung Internet, and the Wacom pen in desktop browsers,
is TBA, and it is the first thing tested on each device; the canvas draws a steady line width when
a device reports no pressure. Coalesced events give every sample the hardware delivers between two
screen frames, which keeps fast handwriting smooth. Chrome, Firefox and Safari support them, but
not every browser does, so the canvas checks for them and falls back to single events. Strokes are
drawn as pressure-sensitive outlines with the perfect-freehand library (MIT).

Palm rejection follows one rule. While a pen is in use on the canvas, touches do not draw, and two
fingers pan and zoom instead. The tools are pen, highlighter, eraser (by stroke), lasso to select
and move strokes, undo and redo, insert space, clear and zoom. The eraser end of a Wacom pen erases
directly. Whether the S Pen side button can be read by a browser is TBA and will be tested on the
device; if it can, it switches to the eraser while held. A small pen check page shows, live, what a
device reports (pointer type, pressure, tilt, buttons and coalesced samples), so each pen can be
tested in half a minute before the canvas settings are tuned to it.

The three layouts share the same canvas. On a phone in portrait, the statement collapses to a bar
at the top, the canvas scrolls downward without limit and the tools sit in a bar at the bottom
within thumb reach. On a tablet in landscape, the statement and the canvas sit side by side, and in
portrait they stack. On a desktop with a Wacom tablet, the canvas is wide, the statement stays
visible and the tools have keyboard shortcuts. Strokes are saved as a draft while the learner
writes, so a reload or a lost connection loses nothing. Each stroke is stored as a list of points
with position, pressure and time, which keeps the original handwriting available for a second
recognition later.

### 5.3 From handwriting to LaTeX

On Submit, the browser renders the strokes to an image (white background, cropped to the writing
and scaled to a fixed width) and sends the image and the stroke data to Lingo. The server loads the
learner's AI settings, decrypts the key for the chosen provider and sends the image to that
provider through the egress proxy of section 6.2. The request asks for a structured answer, a list
of lines, each with its LaTeX and a confidence value. Lingo shows each line as an editable formula
in a MathLive field, which has a virtual math keyboard for corrections on a tablet or phone.
Corrections are made by the learner and cost no AI call.

Recognition goes through one provider interface with an adapter for OpenAI, for Anthropic and for
Google. All three accept images in requests. Each learner chooses a provider and a model for
recognition. Two kinds of further adapters can be added later behind the same interface. Mathpix is
a specialised service whose strokes endpoint takes the pen data directly instead of an image.
Open models can run on the workstation's GPU, and among them TexTeller (Apache-2.0) and the
Pix2Text formula model (MIT) are trained on handwritten formulas, while pix2tex (MIT) handles
printed formulas well but handwriting only partly.

### 5.4 Grading and explanations of mistakes

Grading has two layers, so that the AI model is never the only judge of correctness. The first
layer is deterministic. The final answer from the answer box is parsed with the Cortex Compute Engine and
compared with the stored answer numerically within a tolerance, symbolically for expressions, and
with unit conversion for quantities with units. The second layer is the AI step analysis. The
provider receives the problem, the stored reference solution and the learner's lines, and returns a
structured verdict.

```json
{
  "finalAnswerCorrect": false,
  "firstWrongLine": 3,
  "mistakeType": "sign error",
  "explanation": "Moving 4x to the right side changes its sign, so the line should read 2x - 4x = 6.",
  "correctedLine": "-2x = 6",
  "nextHint": "Divide both sides by -2."
}
```

The deterministic layer decides whether the final answer is right; the AI layer explains the path.
If the two disagree, the deterministic result is shown and the disagreement is recorded for review.
A learner can ask follow-up questions about the explanation by typing or by voice, and the
conversation is stored with the attempt.

Analyses are stored and reused. Each analysis is saved under a fingerprint of the problem, the
solution version and the learner's normalised LaTeX lines, so the same work submitted again is
answered from the database without an AI call. An author can also promote a stored analysis to a
"common mistake" of that problem, which is then shown instantly to anyone whose work matches it.

### 5.5 Animated solutions

A solution is a script, stored as JSON, that a player turns into an animation. The script lists
the elements of the scene and the steps that change them. The player draws every frame from the
script and the current position on the timeline, rather than starting animations and letting them
run, so dragging the handle backwards or forwards always shows exactly the right state.

The elements cover the range of problems that Brilliant-style courses use. The question text is
split into addressable spans so that a number or a phrase can be highlighted and lifted out of it.
Givens are named quantities with a symbol, a value, a unit and the span they came from. Equations
are LaTeX rendered with KaTeX, whose `\htmlClass` and `\htmlId` commands tag each term so that the
same term can be followed from one equation to the next. These commands are off by default, so the
player enables them through KaTeX's `trust` option for those commands only and relaxes its `strict`
setting for them; LaTeX from learners and from AI output is rendered without these commands. Graphs (functions, points, vectors, areas
under curves) are drawn with Mafs, a set of React components for interactive mathematics. Geometry
constructions, free-body diagrams, number lines and tables are drawn as SVG.

| Step kind | What the learner sees |
|---|---|
| Extract | A span of the question lights up and flies into a card that names it, for example a speed of 12 m/s becoming the given v |
| Relate | Givens move into an equation that connects them |
| Substitute | A given flies into the matching symbol of an equation |
| Transform | One form of an equation becomes the next; terms that persist move to their new places, new terms fade in and removed terms fade out |
| Plot | A curve is drawn, a point moves along it or an area fills |
| Construct | A geometry figure gains a line, an angle or a label |
| Annotate | An arrow or a short note points at a term or a part of a figure |
| Answer | The result is boxed and checked against the question |

The timeline driver is written for Lingo rather than taken from an animation library. The steps
need only movement, scaling, colour and fading, which a small driver computes directly from the
timeline position. GSAP, the best known library for scrubbable timelines, is free to use but under
a license that is not open source and restricts some uses, which does not suit a public MIT fork.

A short kinematics example shows the flow. The question says that a cyclist rides 120 m at
12 m/s and asks for the time. Two Extract steps lift the distance and the speed into givens, a
Relate step brings them into the equation

$$
d = v\,t
$$

a Transform step isolates the time

$$
t = \frac{d}{v}
$$

and a Substitute step followed by a final Transform gives the answer.

$$
t = \frac{120\ \text{m}}{12\ \text{m/s}} = 10\ \text{s}
$$

Each step has a duration and an optional narration text. The player shows a timeline with a
handle, play and pause, step markers, a speed control and keyboard shortcuts (space to play or
pause, arrow keys to move between steps). Narration is read by the voice service once, stored as
audio in the media folder and replayed in step with the animation, with subtitles. When the grading
found a wrong line, the player can open at the matching step and show the learner's line beside the
correct one.

### 5.6 Creating solutions in the app

Solutions are made once and reused, so the AI is never called when a solution is played. An author
(an admin account) opens a problem in author mode. Selecting text in the question creates a given.
Each equation state is typed in a MathLive field, and the editor matches identical terms between
consecutive states automatically, with a click to link or unlink terms by hand. Graph, geometry
and diagram steps are added from a palette and placed on the canvas. A preview plays the script
at any time.

A "Draft with AI" button asks the author's provider for a first script from the question and the
reference answer. The author edits the draft and saves it. Every save creates a new version, the
previous versions stay available, and stored analyses keep the version they were made against.

### 5.7 Answer types

A Brilliant-like range needs more than one kind of answer. The first phase supports numeric answers
with units and tolerance, expressions checked for symbolic equivalence, multiple choice and
free-form worked solutions graded by the AI layer. Later phases add sets and intervals, points
placed on a graph, sketches drawn on axes, ordering of steps and short proofs.

### 5.8 Data model

Math problems are challenges of a new type `MATH`, so they live inside lessons and count for
hearts, points and quests like every other exercise. The problem statement, figure, answer
specification and tolerance live in the challenge `payload`. Four new tables hold the rest.

| Table | Contents |
|---|---|
| `math_solutions` | Solution scripts per challenge, with version number, author and time |
| `math_attempts` | Strokes, rendered image path, recognised and corrected LaTeX, grading result, provider and model used, and the follow-up conversation |
| `math_analyses` | Stored analyses by fingerprint, with a flag for author-promoted common mistakes |
| `user_ai_settings` | Per user and provider, the encrypted key, its last four characters, the chosen models, and voice preferences |

## 6. AI, voice and the network

### 6.1 Providers and keys

Each account has a settings page with one key field per provider (OpenAI, Anthropic and Google),
a test button that checks a key with a minimal request, and a choice of provider and model for each
task (recognition, grading, drafting solutions). Keys are encrypted with AES-256-GCM (the Advanced
Encryption Standard in Galois/Counter Mode) before they reach the database. The encryption key
lives in a new secrets file next to the database password file on the server and is locked the
same way. A saved key is never sent back to the browser; the page shows only its last four
characters and offers to replace or delete it. Keys and request bodies are never written to logs.
Lingo records the number of tokens each request used, per account, so usage stays visible.

### 6.2 A narrow way out to the AI providers

The app container keeps its lack of internet access. A new egress proxy container (Squid) joins
the app on a private network and alone has a route out. Its allowlist names only the API hosts of
the three providers. The app sends provider requests through the proxy as HTTPS connections, so
encryption runs end to end between the app and the provider, and the proxy sees only which host is
contacted. The allowlist is set in the stack configuration on the server, never from the web
interface, so that no user can point the app at an arbitrary address.

### 6.3 Voice through the workstation

Speech runs for now on the voice containers of the workstation, which has the GPU. The
recommendation is a dedicated voice stack for Lingo on the workstation, with its own Kokoro
container for text-to-speech, its own speaches container for speech-to-text with a Whisper model,
and a small gateway (Caddy) in front of both. This leaves the voice containers of other projects
untouched. The gateway serves HTTPS with a certificate from its own internal authority, which the
Lingo app is set to trust. It requires a long random token on every request, allows only the speech
and transcription endpoints, and listens on one port of the workstation's local network address. A
Windows Firewall rule opens that port only to the server's address, and the router reserves both
addresses so they do not change. On the server, the egress proxy allowlists that one address and
port, and the token lives in the same secrets file as the encryption key.

The workstation is a laptop, so voice is sometimes unavailable. Lingo checks the gateway before
showing voice controls and hides them with a short note when it cannot reach it. The browser's
built-in speech synthesis can stand in for read-aloud in that case if the learner turns the option
on. Moving the voice containers to the server later only changes the gateway address.

### 6.4 Voice in the interface

Each account sets voice on or off, a voice and a speed. Explanations, hints and narrations get a
play button, and a microphone button lets the learner ask a follow-up question by holding to talk.
The transcription appears in the text field for a check before it is sent. The `Permissions-Policy`
header allows the microphone for Lingo's own pages only.

## 7. Security and privacy

The design adds four kinds of exposure, and each gets a specific control. Secrets (AI keys, the
encryption key, the voice token) are encrypted or kept in locked files next to the existing ones,
never inside the app folder that is a clone of the public fork, and never in the database in clear
text. Code written by learners runs either in the learner's own browser, where it can only slow
down that tab, or in the unprivileged runner containers, which have no internet and no access to
the other services. Data sent to AI providers is limited to the problem, the reference solution and
the learner's handwriting or code, and goes only to the provider the learner chose, with the
learner's own key. Every AI and voice route is rate limited per account and has size caps on images
and audio.

The header changes are narrow. The content security policy gains `worker-src` for the code runners
and `wasm-unsafe-eval` for Pyodide and sql.js. Code runner frames are created by the app itself
with sandbox attributes and are never loaded from another site. `X-Frame-Options` stays `DENY` for
every page of the app. The microphone is allowed for Lingo's own origin only. Content committed to
the public fork stays generic, with example courses only, and household content keeps living in
the server's courses and media folders.

## 8. Tasks and phases

The work is split into phases that each end with something usable. Every phase is tested on the
local test stack first, then deployed to the server with a database backup taken before the
migration, as in earlier rounds.

| Phase | Contents | Done when |
|---|---|---|
| 1. Foundations | Schema additions, AI settings page with encrypted keys, egress proxy, provider adapters with a key test | Each provider answers a test request through the proxy with a stored key |
| 2. Math core | Ink canvas with three layouts, recognition to editable LaTeX, deterministic answer check, AI step analysis, stored analyses, attempt history | A handwritten solution is recognised, corrected, graded and explained on phone, tablet and desktop |
| 3. Animated solutions | Script format, player with timeline handle, equation transforms, givens from the question text, graphs and figures, author mode, drafting with AI, versions | A solution made in the app plays, pauses and scrubs correctly and opens at the learner's wrong step |
| 4. Voice | Voice stack and gateway on the workstation, firewall route, read-aloud with cached narration, follow-up questions by voice | Narration and follow-up questions work from a phone, and voice hides cleanly when the laptop is away |
| 5. Coding in the browser | Coding exercise types, CodeMirror layouts with the phone symbol bar, JavaScript, TypeScript, Python, SQL and web runners, tests, completion tiers one and two | A Python and a JavaScript course run end to end on phone and desktop |
| 6. Coding on the server | Unprivileged runner containers per language family, input and output tests, languages added by course, optional language servers | A C# course runs end to end, and the runner has no route to the internet or the other services |
| 7. Content | Example math sets across algebra, geometry, calculus, probability and physics, an example coding course per runtime, updated course-file documentation | New courses can be written from the documentation alone |

## 9. Risks and open questions

Recognition of handwriting varies between providers and with the neatness of the writing. The
editable LaTeX step keeps a misread from turning into a wrong grade, and the stored strokes allow a
second attempt with another provider. The quality of AI explanations varies in the same way, which
is why the deterministic layer decides correctness and why authors can promote good explanations
to common mistakes.

Running other people's code on the server is the largest security risk in the design. The
unprivileged runner containers, the absence of network access and the limits on each run address
it, and the runner phase comes last so that the rest of the app does not depend on it.

Voice depends on the laptop being on the home network and awake. The design treats voice as an
addition that disappears cleanly when unavailable, and moving it to the server later is a change of
address only.

Writing animated solutions for a wide range of mathematics is the largest content effort. AI
drafts, automatic term matching and reuse of stored scripts reduce it, but each new kind of figure
needs its own step kind in the player.

Several items stay open until they can be measured. On the devices, the S Pen's pressure and side
button and the Wacom pen's pressure are tested with the pen check page once phase 2 is deployed.
The voice stack's GPU memory use next to the other workloads on the workstation is measured in
phase 4. The download size of a C# compiler in the browser and the order in which server languages
arrive are settled at the start of phase 6. The GPU needs of the
open handwriting models are measured only if a local recognizer is added.

## 10. Sources

Checked on 27 October 2026 against each project's own pages.

| Topic | Source |
|---|---|
| Monaco has no mobile browser support | https://github.com/microsoft/monaco-editor |
| CodeMirror 6, mobile support, packages, license | https://codemirror.net/ |
| Pyodide, license, core size, package list with Jedi | https://pyodide.org/en/stable/usage/packages-in-pyodide.html |
| sql.js, SQLite in WebAssembly, license | https://github.com/sql-js/sql.js |
| Piston, license, languages, privileged container, public service | https://github.com/engineer-man/piston |
| Judge0, license, privileged containers, reported escapes | https://github.com/judge0/judge0 |
| C# compiled in the browser | https://github.com/MicrosoftLearning/c-sharp-minor |
| Try .NET archived and retired | https://github.com/dotnet/try |
| Pointer Events and coalesced events browser support | https://raw.githubusercontent.com/mdn/browser-compat-data/main/api/PointerEvent.json |
| perfect-freehand | https://github.com/steveruizok/perfect-freehand |
| KaTeX commands and the trust option | https://katex.org/docs/supported.html |
| MathLive | https://github.com/arnog/mathlive |
| Cortex Compute Engine | https://github.com/cortex-js/compute-engine |
| GSAP standard license | https://gsap.com/community/standard-license/ |
| Mathpix strokes endpoint | https://docs.mathpix.com/reference/post-v3-strokes |
| pix2tex | https://github.com/lukas-blecher/LaTeX-OCR |
| TexTeller | https://github.com/OleehyO/TexTeller |
| Pix2Text formula model | https://huggingface.co/breezedeus/pix2text-mfr-1.5 |
| Images in Claude requests | https://platform.claude.com/docs/en/build-with-claude/vision |
| Images in Gemini requests | https://ai.google.dev/gemini-api/docs/image-understanding |
| Images in OpenAI requests | https://developers.openai.com/api/docs/guides/images-vision |
| Kokoro-FastAPI speech endpoint | https://github.com/remsky/Kokoro-FastAPI |
| speaches transcription endpoint | https://speaches.ai/usage/speech-to-text/ |
| Squid allowlist by destination domain | https://fabianlee.org/2017/02/23/squid-controlling-network-access-using-squid-and-whitelisted-domains/ |
