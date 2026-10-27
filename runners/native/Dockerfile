# Lingo code runner for C and C++ with GCC. Build context: the runners folder.
# The toolchain is the official GCC image.
ARG GO_VERSION=1.27.3-alpine3.24
ARG GCC_VERSION=15.3.0-trixie

FROM golang:${GO_VERSION} AS service
WORKDIR /src
COPY service/ ./
RUN CGO_ENABLED=0 go build -trimpath -ldflags="-s -w" -o /out/lingo-runner .

FROM gcc:${GCC_VERSION}
COPY --from=service /out/lingo-runner /opt/lingo/lingo-runner
RUN useradd --uid 10001 --user-group --no-create-home --home-dir /tmp --shell /usr/sbin/nologin runner
ENV LINGO_RUNNER_LANGUAGES=c,cpp
USER 10001:10001
EXPOSE 8080
ENTRYPOINT ["/opt/lingo/lingo-runner"]
