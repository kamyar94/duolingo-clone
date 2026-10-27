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
  app/                     git clone of the repository
  media/  courses/  backups/
```

The three secret files are read only by the containers that need them. Lock them so that only
the account running Docker can read them, and keep them out of the `app` folder, which is a
clone of a public repository. The `.gitignore` here refuses filled-in env files for the same
reason.

## The services

The stack has four services, and only two of them can reach the internet. Every container runs
without Linux capabilities, with `no-new-privileges`, on a read-only root filesystem and with
limits on memory, CPU and processes. No service publishes a port on the host.

**db** is Postgres. It runs as the unprivileged postgres user and keeps its data in the Docker
volume `db`. It sits on the internal `backend` network, which only the app shares.

**app** is the Lingo web app, built from `./app`. It runs as the unprivileged node user and
reads `./media` and `./courses` without being able to change them. It applies the database
migrations itself on every start, so an update needs no separate migration step, but a backup
of the database before every update stays the rule. The app sits on three internal networks,
one each for the tunnel, the database and the egress proxy, and none of them leads to the
internet.

**egress** is a Squid proxy and the app's only way out. It accepts HTTPS tunnels to
`api.openai.com`, `api.anthropic.com` and `generativelanguage.googleapis.com` on port 443 and
refuses everything else, including other hosts, other ports, plain http and bare IP addresses.
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

## First start and updates

On a new server, copy the templates to their real names, fill in the address, the database
password, the tunnel token and a fresh `LINGO_SECRET_KEY`, then build and start.

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
service, and the new `SQUID_VERSION` line in `.env`.

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

## Later phases

Two parts of the design arrive later, and the compose file and `squid.conf` mark the places
where they go with `PHASE 4` and `PHASE 6` comments.

Voice (phase 4) runs on a separate voice gateway. The egress proxy will allow that gateway as
one address and one port, and its token will live in `ai.env`.

Code runners (phase 6) run learners' programs for languages that cannot run in the browser.
Each language family gets its own unprivileged runner container on an internal `runners`
network that only the app shares, with no route to the internet or to the other services.
