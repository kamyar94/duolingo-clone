# Lingo code runner for Go. Build context: the runners folder.
# The toolchain is the official Go image. A build cache of the standard library packages that
# lessons use is made here, with the same settings as a run (runners/service/languages.go), and
# kept read-only in the image; every run starts from a fresh copy of it.
ARG GO_VERSION=1.27.3-alpine3.24

FROM golang:${GO_VERSION} AS service
WORKDIR /src
COPY service/ ./
RUN CGO_ENABLED=0 go build -trimpath -ldflags="-s -w" -o /out/lingo-runner .

FROM golang:${GO_VERSION}
COPY --from=service /out/lingo-runner /opt/lingo/lingo-runner
COPY go/warm.go /tmp/warm/main.go
RUN set -eu; cd /tmp/warm; \
    GOCACHE=/opt/lingo/gocache GOPATH=/tmp/gopath GOENV=off GOFLAGS=-trimpath GOPROXY=off \
    GOTOOLCHAIN=local CGO_ENABLED=0 go build -o /tmp/warm/main main.go; \
    rm -rf /tmp/warm /tmp/gopath; chmod -R a+rX /opt/lingo/gocache; \
    adduser -D -H -u 10001 -h /tmp -s /sbin/nologin runner
ENV LINGO_RUNNER_LANGUAGES=go \
    LINGO_GOCACHE_SEED=/opt/lingo/gocache
USER 10001:10001
EXPOSE 8080
ENTRYPOINT ["/opt/lingo/lingo-runner"]
