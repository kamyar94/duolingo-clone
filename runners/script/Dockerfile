# Lingo code runner for Ruby, PHP, Perl, Lua and Bash. Build context: the runners folder.
# The base is the official Ruby image (Debian, with Perl and Bash); PHP and Lua come from the
# Debian packages of the same release.
ARG GO_VERSION=1.27.3-alpine3.24
ARG RUBY_VERSION=4.0.9-slim-trixie

FROM golang:${GO_VERSION} AS service
WORKDIR /src
COPY service/ ./
RUN CGO_ENABLED=0 go build -trimpath -ldflags="-s -w" -o /out/lingo-runner .

FROM ruby:${RUBY_VERSION}
COPY --from=service /out/lingo-runner /opt/lingo/lingo-runner
RUN set -eu; apt-get update; \
    apt-get install -y --no-install-recommends php-cli lua5.4 perl; \
    rm -rf /var/lib/apt/lists/*; \
    useradd --uid 10001 --user-group --no-create-home --home-dir /tmp --shell /usr/sbin/nologin runner
ENV LINGO_RUNNER_LANGUAGES=ruby,php,perl,lua,bash
USER 10001:10001
EXPOSE 8080
ENTRYPOINT ["/opt/lingo/lingo-runner"]
