# The Lingo voice stack

This folder holds a small Docker stack that gives Lingo a voice. It reads explanations, hints
and the narration of animated solutions aloud, and it turns a spoken follow-up question into
text. It is meant for a computer with an NVIDIA GPU, such as a workstation or a gaming laptop
on the same home network as the Lingo server. It contains no secrets and no addresses of real
machines, and it is separate from the Lingo server stack in the folder above and from any other
voice containers that already run on the same computer.

## What runs

The stack has three long-running containers and one job that runs once.

**kokoro** turns text into speech with the Kokoro model. The model is part of its image, so the
container needs no internet access at all.

**speaches** turns speech into text with a Whisper model. It runs offline from a Docker volume
that the setup job fills, and the model leaves the GPU after a few minutes without use, so an
idle stack holds almost no video memory besides Kokoro.

**gateway** is Caddy and the only container with a published port. It serves HTTPS on port 8443
with a certificate from its own internal certificate authority and requires a long random bearer
token on every request, health checks included. A request without the token gets a 401 on any
path. With the token, only four requests pass. `POST /v1/audio/speech` goes to Kokoro and
`POST /v1/audio/transcriptions` goes to speaches. `GET /health` asks Kokoro and
`GET /health/transcription` asks speaches, which is how Lingo finds out whether voice works.
Everything else gets a 404, so model lists, voice lists and documentation pages cannot be
reached. The token is removed before a request is passed on, and request bodies are limited to
32 KB for speech and 12 MB for recordings.

**setup** is the one-off job that downloads the Whisper model. It is the only container that
reaches the internet, and only when you start it by hand.

Kokoro and speaches sit on an internal Docker network with no route to the internet or to
anything else on the computer. The gateway sits on that network and on a second one that carries
its published port.

## Before you start

You need Docker with GPU support (on Windows, Docker Desktop with the WSL 2 backend and a current
NVIDIA driver), the images for Kokoro, speaches and Caddy, and a reserved local network address
for this computer. Reserve the address in your router so that it does not change, and do the same
for the Lingo server, because the firewall rule and the proxy allowlist both name an address. The
images are `ghcr.io/remsky/kokoro-fastapi-gpu`, `ghcr.io/speaches-ai/speaches` (the `latest-cuda`
tag) and `caddy`. The compose file uses the tags listed in `voice.env.example`. Once the stack
works for you, replace `latest` with a version tag or a digest so that an update never arrives by
surprise.

## First start

Copy `voice.env.example` to `.env` in this folder and fill it in. `VOICE_HOST` is the address
the Lingo server will use to reach the gateway, which is the reserved address of this computer.
The gateway's certificate is made for exactly that value. `VOICE_BIND` is the address the port is
published on, and the same address as `VOICE_HOST` is the right choice. `VOICE_TOKEN` is a long
random token of at least 32 characters, and the gateway refuses to start with a shorter one. In
PowerShell one way to make it is

```
$b = New-Object byte[] 32; [Security.Cryptography.RandomNumberGenerator]::Create().GetBytes($b); ($b | ForEach-Object { $_.ToString('x2') }) -join ''
```

and in a Linux shell it is `openssl rand -hex 32`. Choose the two subnets so that nothing else on
the computer uses them. `docker network ls` and `docker network inspect` show the ranges that
are taken.

Then install the Whisper model once. The model is a download of a few hundred megabytes, and it
is kept in the `whisper-models` volume, so this step is not repeated after updates.

```
docker compose --profile setup run --rm setup
```

The default model is `Systran/faster-whisper-small`. Set `WHISPER_MODEL` in `.env` before this
step to use another one, for example `Systran/faster-whisper-base.en` for a smaller English-only
model, and give the Lingo server the same name in `VOICE_STT_MODEL`.

Start the stack.

```
docker compose up -d
docker compose ps
```

All three containers should become healthy within about two minutes. Kokoro takes the longest,
because it loads its model onto the GPU.

## Trusting the gateway's certificate

The gateway made its own certificate authority on first start. The Lingo server must trust that
authority, and nothing else, for this connection. Copy the authority's root certificate out of the
gateway's volume and put it on the Lingo server as `voice-ca/ca.pem`, next to the compose file there.

```
docker compose cp gateway:/data/caddy/pki/authorities/local/root.crt ./ca.pem
```

The file holds a public certificate and no secret. The authority is kept in the `gateway-data`
volume, so the file stays valid across restarts and updates. If you delete that volume, the gateway
makes a new authority and you copy the new file over.

## Opening the firewall for the server only

Windows Firewall blocks the gateway's port until a rule allows it. `Open-VoiceFirewall.ps1` adds
one inbound rule for the gateway's port, open to the Lingo server's address and to no other
address. Read it first, try it with `-WhatIf`, and run it yourself in an elevated PowerShell.

```
.\Open-VoiceFirewall.ps1 -ServerAddress 192.0.2.20 -WhatIf
.\Open-VoiceFirewall.ps1 -ServerAddress 192.0.2.20
```

Replace the example address with the Lingo server's reserved address. The script changes nothing
else, and `.\Open-VoiceFirewall.ps1 -Remove` deletes the rule again. If you publish the port on
`127.0.0.1` for a test on this computer, no rule is needed.

## Connecting the Lingo server

Three settings on the server make the connection. In `ai.env` set `VOICE_URL` to
`https://` plus the gateway's address and port, and `VOICE_TOKEN` to the same token as in the
voice stack's `.env`. In `squid.conf`, remove the three leading `#` characters of the voice block
and put the gateway's address and port into it, so that the egress proxy accepts exactly that one
destination. Then place `ca.pem` in the `voice-ca` folder and restart the app and the proxy.

```
docker compose up -d --force-recreate app egress
```

Each learner then turns voice on in the settings page, where a status line shows whether the
gateway answers and a sample button plays a short sentence. When the computer is off or asleep,
Lingo hides the voice controls with a short note, and a learner can allow the browser's own voice
as a stand-in on each device.

## Checking it by hand

From the computer itself, with the root certificate saved as `ca.pem` and the token in a variable,
the following requests show each rule of the gateway.

```
curl --cacert ca.pem https://127.0.0.1:8443/health
curl --cacert ca.pem -H "Authorization: Bearer $VOICE_TOKEN" https://127.0.0.1:8443/health
curl --cacert ca.pem -H "Authorization: Bearer $VOICE_TOKEN" https://127.0.0.1:8443/v1/models
```

The first gets a 401, the second prints `{"status":"healthy"}`, and the third gets a 404 because
that path is not one of the four the gateway passes. On Windows, add `--ssl-no-revoke` to curl,
since a private authority has no revocation list.

## GPU memory

Kokoro keeps its model on the GPU while it runs. In a test on an NVIDIA GeForce RTX 4090 Laptop
GPU, the stack added about 1.4 GB of video memory when idle and about 2 GB at the peak, while
Whisper was loaded for a transcription. Whisper left the GPU again after the idle time set by
`WHISPER_TTL`, and everything was freed when the stack stopped. A longer text or a larger Whisper model needs more, so check `nvidia-smi` after you
change the model.

## Day to day

Narration clips are made once and kept by the Lingo server, so most playback needs no GPU at all.
Only a new text, a new voice or a new speed reaches Kokoro. To change the token, edit `.env` here
and `ai.env` on the server and restart both sides. To update an image, change its tag in `.env`,
run `docker compose pull`, and start the stack again. To remove the stack, run `docker compose
down`, which keeps the two volumes, and add `-v` only if you also want to delete the Whisper model
and the certificate authority.

## Notes on the settings

The gateway container runs as root inside the container, with a read-only filesystem, no new
privileges and only the one capability that the Caddy binary needs to start. It writes only to its
two volumes. Kokoro's `/tmp` is the one place that allows execution, because its speech code loads
a small library from there. The token appears in the gateway's environment, so anyone who can run
`docker inspect` on this computer can read it, which is the same trust as the computer itself.
