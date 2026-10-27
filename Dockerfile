# Lingo (self-hosted build of sanidhyy/duolingo-clone).
# Built by ..\Start.ps1 through docker compose; the Node version is pinned in ..\.env.
ARG NODE_VERSION=24.22.1-alpine3.24

# ---- dependencies (re-used while package.json and the lockfile stay the same) ----
FROM node:${NODE_VERSION} AS deps
WORKDIR /src
ENV NEXT_TELEMETRY_DISABLED=1 DO_NOT_TRACK=1
RUN npm install -g pnpm@11.11.0 --no-fund --no-audit
COPY package.json pnpm-lock.yaml pnpm-workspace.yaml ./
RUN pnpm install --frozen-lockfile

# ---- build: Next.js standalone server + the two server scripts bundled with their libraries ----
FROM deps AS build
COPY . .
RUN pnpm exec next build --turbopack \
 && pnpm exec esbuild scripts/start.mjs scripts/lingo.mjs --bundle --platform=node --format=esm \
      --target=node24 --outdir=dist --out-extension:.js=.mjs --external:pg-native \
      "--banner:js=import { createRequire } from 'node:module'; const require = createRequire(import.meta.url);"

# ---- runtime: no build tools, no package manager, runs as the unprivileged node user ----
FROM node:${NODE_VERSION} AS app
WORKDIR /app
ENV NODE_ENV=production NEXT_TELEMETRY_DISABLED=1 HOSTNAME=0.0.0.0 PORT=3000
RUN rm -rf /usr/local/lib/node_modules/npm /usr/local/lib/node_modules/corepack /usr/local/bin/npm /usr/local/bin/npx /usr/local/bin/corepack /opt/yarn* /usr/local/bin/yarn /usr/local/bin/yarnpkg
COPY --from=build /src/.next/standalone ./
COPY --from=build /src/.next/static ./.next/static
COPY --from=build /src/public ./public
COPY --from=build /src/drizzle ./drizzle
COPY --from=build /src/courses ./courses
COPY --from=build /src/dist ./scripts
# Writable folder for the narration audio that the voice server made (deploy/docker-compose.yml
# mounts a volume here; a new volume takes over this owner).
RUN mkdir -p /voice-data && chown node:node /voice-data
USER node
EXPOSE 3000
CMD ["node", "scripts/start.mjs"]
