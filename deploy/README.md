# Deploying Lingo with Docker

This folder holds public templates for running Lingo as a hardened Docker stack on a home
server. It contains no secrets and no addresses of real machines. Copy it to a folder on the
server, clone the app into a subfolder named `app`, fill in the settings files and start the
stack with Docker Compose.

```
lingo/                     this folder, copied
  docker-compose.yml
  squid.conf
  .env                     from .env.example
  db.env                   from db.env.example (secret)
  ai.env                   from ai.env.example (secret)
  cloudflared.env          from cloudflared.env.example (secret)
  runner.env               from runner.env.example (secret, for the code runners)
  app/                     git clone of the repository
  media/  courses/  backups/
  voice-ca/                ca.pem, the voice gateway's root certificate (optional, see below)
```

The `voice` folder of the repository is the voice stack for the GPU workstation. It runs on that
computer, not on the server, so it does not need to be copied there.

The secret files are read only by the containers that need them. Lock them so that only
the account running Docker can read them, and keep them out of the `app` folder, which is a
clone of a public repository. The `.gitignore` here refuses filled-in env files for the same
reason.

## The services

The stack has four services and a set of optional code runners, and only two services can reach
the internet. Every container runs without Linux capabilities, with `no-new-privileges`, on a
read-only root filesystem and with limits on memory, CPU and processes. No service publishes a
port on the host. The code runners have their own section below.

**db** is Postgres. It runs as the unprivileged postgres user and keeps its data in the Docker
volume `db`. It sits on the internal `backend` network, which only the app shares.

**app** is the Lingo web app, built from `./app`. It runs as the unprivileged node user and
reads `./media` and `./courses` without being able to change them. It applies the database
migrations itself on every start, so an update needs no separate migration step, but a backup
of the database before every update stays the rule. The app sits on internal networks only, one
each for the tunnel, the database and the egress proxy plus one per code runner, and none of them
leads to the internet. Its one writable place is the `voice-data` volume, which keeps the
narration audio that the voice server made.

**egress** is a Squid proxy and the app's only way out. It accepts HTTPS tunnels to
`api.openai.com`, `api.anthropic.com` and `generativelanguage.googleapis.com` on port 443 and
refuses everything else, including other hosts, other ports, plain http and bare IP addresses.
The one exception is the voice gateway, which a commented block in `squid.conf` allows as one
address and one port once the voice stack runs.
Because the app opens a tunnel and encrypts inside it, the proxy learns only which of the three
hosts is contacted, never the keys or the content. The allowlist lives in `squid.conf` on the
server, so nothing in the web interface can widen it. The proxy writes no cache and no files,
and its log shows one line per tunnel with the host and port.

**tunnel** is the Cloudflare Tunnel connector. Cloudflare's edge terminates HTTPS for the
public address and the connector forwards the traffic to the app over the internal `tunnel`
network. Its token lives only in `cloudflared.env`.

## What changed for coding lessons and math practice

Math practice reads handwriting and explains mistakes with an AI provider that each learner
chooses, using the learner's own API key. Three things in the stack make that possible without
opening the app to the internet.

The first is the egress service described above, together with the internal `egress` network
it shares with the app and the outbound `egress-out` network that only it has. The app finds
the proxy through `AI_PROXY_URL`, which the compose file sets to `http://egress:3128`.

The second is `ai.env`, a new secrets file for the app container. It holds `LINGO_SECRET_KEY`,
the server key that encrypts every learner's AI keys with AES-256-GCM before they reach the
database. A saved key is never sent back to a browser, and the settings page shows only its last
four characters. Keep a copy of `LINGO_SECRET_KEY` with the database backups, because a restored
database is of little use for AI features without it.

The third is a set of optional settings in `.env`. `AI_RATE_PER_MINUTE` and `AI_RATE_PER_DAY`
limit the AI requests of each account, and `AI_REQUEST_TIMEOUT_MS` bounds a single request.

Voice adds no service to this stack. Its containers run on the GPU workstation, described under
"Voice" below, and the app reaches them through the egress proxy. On the app service, voice adds
the `voice-data` volume for narration audio and a read-only `voice-ca` folder with the
gateway's root certificate, and `ai.env` gains the gateway's address and token.

Coding lessons in JavaScript, TypeScript, Python, SQL and HTML need nothing new in the stack.
These exercises run in the learner's browser, and the app serves their runtimes (Pyodide,
sql.js and the TypeScript compiler, about 30 MB) from its own image. The image build copies them
in with `scripts/build-runtimes.mjs` and fetches two small Python wheels for code completion
from PyPI, which is the only download the build adds. A build without that access still works
and leaves Python completion at keywords.

Lessons in C#, Java, Kotlin, C, C++, Go, Rust, Ruby, PHP, Perl, Lua and Bash run in the code
runners described below. They add one secrets file, `runner.env`, which the app and the
runners share, and one internal network per runner between it and the app.

## First start and updates

On a new server, copy the templates to their real names, fill in the address, the database
password, the tunnel token, a fresh `LINGO_SECRET_KEY` and a fresh `RUNNER_TOKEN`, then build and
start. With `COMPOSE_PROFILES` set in `.env`, the two compose commands below also build and
start the chosen code runners.

```
docker compose build app
docker compose up -d
docker compose exec app node scripts/lingo.mjs invite --note first-admin --admin
```

For an update, take a database backup first, pull the new code into `./app`, then rebuild and
restart the app. The new migration is applied when the app starts.

```
docker compose exec db pg_dump -U lingo -d lingo -Fc -f /backups/before-update.dump
git -C app pull
docker compose build app
docker compose up -d
```

An existing stack from before this change needs three additions. These are the new `egress`
service with its two networks, the extra `egress` network and the `ai.env` file on the app
service, and the new `SQUID_VERSION` line in `.env`. The code runners add the `x-runner`
block, the six runner services and their networks, the runner networks, addresses and
`runner.env` on the app service, and a `COMPOSE_PROFILES` line in `.env`. Voice adds the
`voice-data` volume, the `voice-ca` mount and the `VOICE_CA_FILE` and `VOICE_DATA_DIR`
settings on the app service, the voice lines in `ai.env`, and the voice block in `squid.conf`
once the gateway runs.

## Checking the allowlist

A quick test from a throwaway container on the egress network shows the proxy at work. A
request to a provider through the proxy reaches the provider, which answers 401 without a key,
while any other host is refused with 403 and a direct request has no route at all.

```
docker run --rm --network lingo_egress curlimages/curl:8.23.0 \
  -s -o /dev/null -w "%{http_connect} %{http_code}\n" -x http://egress:3128 https://api.openai.com/v1/models
docker run --rm --network lingo_egress curlimages/curl:8.23.0 \
  -s -o /dev/null -w "%{http_connect} %{http_code}\n" -x http://egress:3128 https://example.com/
docker run --rm --network lingo_egress curlimages/curl:8.23.0 -s -m 5 https://example.com/
```

The first command prints `200 401`, the second `403 000`, and the third fails because the
internal network has no route out. The test key button on the AI settings page runs the same
path from inside the app.

## Voice

Voice runs on a separate stack for the GPU workstation, in the `voice` folder next to this
file, with its own README. It has a Kokoro container for speech, a speaches container with a
Whisper model for transcription and a Caddy gateway in front of both. The gateway serves HTTPS
with its own certificate authority, requires a long random token on every request and passes
only the speech and transcription requests and two health checks.

On the Lingo server, three things connect to it. `VOICE_URL` and `VOICE_TOKEN` go into `ai.env`,
the token being the one place it lives on this side. The gateway's root certificate goes into a
`voice-ca` folder next to the compose file as `ca.pem` (create the folder first, because Docker
makes an empty one owned by root otherwise), which the app trusts for this connection and
nothing else. And `squid.conf` gets the gateway as one address and one port, in the commented
block that is already there, so the egress proxy stays the app's only way out. The app also
writes the narration audio that the voice server makes into the `voice-data` volume, which is
separate from the read-only `./media` folder and can be deleted without losing anything but a
little time, since the clips are made again on their next play.

The workstation is a laptop that is sometimes asleep. The app checks the gateway before it shows
voice controls and hides them with a short note when it cannot reach it, so nothing else in the
stack depends on it.

## Code runners

Languages without a browser runtime run on the server in Lingo's own code runners. There is one
runner per language family, each built from the official image of its languages with a small
runner service added. The service is a static Go program in `app/runners/service`, which fits
into every image without adding a runtime of its own.

| Service | Languages | Built from | Memory |
|---|---|---|---|
| runner-dotnet | C# | .NET runtime image, with the compiler and reference assemblies of the SDK | 768 MB |
| runner-jvm | Java, Kotlin | Eclipse Temurin JDK, with the Kotlin compiler release | 1280 MB |
| runner-native | C, C++ | GCC | 768 MB |
| runner-go | Go | Go | 1280 MB |
| runner-rust | Rust | Rust (slim) | 768 MB |
| runner-script | Ruby, PHP, Perl, Lua, Bash | Ruby (slim), with PHP and Lua from Debian | 512 MB |

A runner handles one program at a time, and further requests wait in a short queue. For each
job the service makes a fresh scratch folder, writes the program into it, compiles it and runs
it once per input as a separate process with a time limit. When the limit passes, or when the
program prints more than 64 KB, every process of the job is stopped, including any that moved
to a new process group. The scratch folder and everything else the program wrote are deleted
before the next job starts. Each step also runs with limits on file size and open files, and
the program is the first candidate when memory runs out, so the runner itself survives.

The isolation comes from the container settings in the `x-runner` block of the compose file,
which every runner shares. They are the strictest settings of the stack.

- No runner is privileged, every Linux capability is dropped, and `no-new-privileges` stops any
  gain of privileges.
- The service and the programs run as the unprivileged user 10001, and the service refuses to
  start as root.
- The root filesystem is read-only. The only writable place is a tmpfs at `/tmp` for scratch
  folders and build output, emptied after every job, plus a small private `/dev/shm`.
- Memory is limited without swap, CPU to one core, processes to 128 and open files to 4096. A
  fork bomb meets the process limit, and a memory hog is killed by the memory limit.
- Each runner sits alone with the app on its own internal network. A program has no route to
  the internet, to the database, to the egress proxy or to the other runners.
- Requests need `RUNNER_TOKEN` from `runner.env`. Programs never see it, because each step gets
  a fresh environment and the service closes its own process files to them.

One path stays open on purpose. A program can reach the app's web port on the runner's
network, which is the same page any visitor reaches through the tunnel, so it gains nothing a
signed-in learner does not already have. The runners also share the host's Linux kernel with
the other containers, so their protection rests on these settings rather than on a separate
machine. A dedicated virtual machine remains the stronger choice if the runners are ever opened
beyond the household.

A runner has no health check, because a check would start a second process with the
container's environment next to the learner's program. Docker restarts a runner when it ends,
and each runner ends on its own when idle after 500 jobs or a day, so runners are recycled
regularly. `docker compose ps` and the runner's log show its state, and the log names only the
language and the timings of each job, never the code or its output.

The app finds the runners through `RUNNER_URL_DOTNET`, `RUNNER_URL_JVM` and the other addresses
that the compose file sets. Only signed-in learners can run programs. Each account gets at most
20 runs a minute and 600 a day by default (`RUNNER_RATE_PER_MINUTE` and `RUNNER_RATE_PER_DAY` in
`.env`) and two runs at a time. A program may have up to 64 KB, and one request may carry up to
20 inputs. A Check sends all inputs of an exercise in one request, so the program compiles once.

The runners start with the compose profile `runners`. Each family also has its own profile
(`dotnet`, `jvm`, `native`, `go`, `rust` and `script`), so a server can run only the languages
its courses use. Put the choice in `.env`, for example `COMPOSE_PROFILES=runners` for all of them
or `COMPOSE_PROFILES=dotnet,jvm` for C#, Java and Kotlin. Languages without a running runner say
in the lesson that they cannot run on this server, and a Check then costs no heart. The images
are large, from about 0.4 GB for C# and the scripting languages to 2.2 GB for GCC, so build only
the families you need.

```
docker compose --profile runners build
docker compose --profile runners up -d
```

The runners have no published port, so they are checked from a throwaway container on their
networks. `app/runners/test` holds a compose file that extends the runner services of this
compose file with a test token, and a smoke test that plays the part of the app. For every
language it runs a hello world with input, a compile error, a runtime error, an endless loop, a
fork bomb, a memory hog, attempts to reach the internet and the other runners, writes outside
the scratch folder, a program that prints without end, leftovers between jobs, a look for the
token and two requests at once. Run it on a test machine rather than next to the real stack.

```
cd app
RUNNER_TOKEN=<a random value> docker compose -f runners/test/compose.yml -p lingo-test-runners up -d --build
RUNNER_TOKEN=<the same value> docker compose -f runners/test/compose.yml -p lingo-test-runners run --rm probe
docker compose -f runners/test/compose.yml -p lingo-test-runners down
```

The test's compose file reads the version settings of this one, so set `POSTGRES_VERSION`,
`NODE_VERSION`, `SQUID_VERSION` and `CLOUDFLARED_VERSION` to any value while it runs. The last
lines of the probe give the number of passed checks per language. Setting
`SMOKE_INTERNET_ADDRESS` to the address of a public server adds an attempt that needs no name
lookup.
