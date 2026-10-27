# Lingo code runner for Rust. Build context: the runners folder.
# The toolchain is the official Rust image (slim, with the C linker it needs). Programs are one
# file compiled with rustc, without Cargo or crates.
ARG GO_VERSION=1.27.3-alpine3.24
ARG RUST_VERSION=1.99.1-slim-trixie

FROM golang:${GO_VERSION} AS service
WORKDIR /src
COPY service/ ./
RUN CGO_ENABLED=0 go build -trimpath -ldflags="-s -w" -o /out/lingo-runner .

FROM rust:${RUST_VERSION}
COPY --from=service /out/lingo-runner /opt/lingo/lingo-runner
# rustc itself rather than the rustup proxy, which would need the rustup settings at run time.
RUN set -eu; ln -s "$(rustc --print sysroot)/bin/rustc" /opt/lingo/rustc; \
    useradd --uid 10001 --user-group --no-create-home --home-dir /tmp --shell /usr/sbin/nologin runner
ENV LINGO_RUNNER_LANGUAGES=rust \
    LINGO_RUSTC=/opt/lingo/rustc
USER 10001:10001
EXPOSE 8080
ENTRYPOINT ["/opt/lingo/lingo-runner"]
