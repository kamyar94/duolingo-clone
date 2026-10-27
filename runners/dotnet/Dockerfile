# Lingo code runner for C#. Build context: the runners folder.
# The C# compiler (Roslyn) and the reference assemblies come from the official .NET SDK image; the
# final image is the official .NET runtime image with only those two folders added, so it carries
# no SDK, no NuGet and no build tools.
ARG GO_VERSION=1.27.3-alpine3.24
ARG DOTNET_SDK_VERSION=10.0.403-noble
ARG DOTNET_RUNTIME_VERSION=10.0.14-noble

FROM golang:${GO_VERSION} AS service
WORKDIR /src
COPY service/ ./
RUN CGO_ENABLED=0 go build -trimpath -ldflags="-s -w" -o /out/lingo-runner .

FROM mcr.microsoft.com/dotnet/sdk:${DOTNET_SDK_VERSION} AS sdk
# csc.rsp lists every reference assembly of the shared framework, as the SDK would pass them.
# Programs are compiled without optimisation, so that errors name the right line.
RUN set -eu; \
    sdk="$(ls -d /usr/share/dotnet/sdk/*/ | sort -V | tail -1)"; \
    ref="$(ls -d /usr/share/dotnet/packs/Microsoft.NETCore.App.Ref/*/ref/net*/ | sort -V | tail -1)"; \
    mkdir -p /opt/lingo; \
    cp -r "${sdk}Roslyn/bincore" /opt/lingo/roslyn; \
    rm -rf /opt/lingo/roslyn/vbc* /opt/lingo/roslyn/Microsoft.CodeAnalysis.VisualBasic.dll; \
    cp -r "$ref" /opt/lingo/ref; \
    { echo "-nostdlib+"; echo "-target:exe"; echo "-langversion:latest"; echo "-nullable:disable"; \
      echo "-optimize-"; echo "-debug:portable"; echo "-deterministic+"; echo "-utf8output"; \
      for dll in /opt/lingo/ref/*.dll; do echo "-r:$dll"; done; } > /opt/lingo/csc.rsp

FROM mcr.microsoft.com/dotnet/runtime:${DOTNET_RUNTIME_VERSION}
COPY --from=sdk /opt/lingo /opt/lingo
COPY --from=service /out/lingo-runner /opt/lingo/lingo-runner
RUN useradd --uid 10001 --user-group --no-create-home --home-dir /tmp --shell /usr/sbin/nologin runner
ENV LINGO_RUNNER_LANGUAGES=csharp \
    LINGO_CSC=/opt/lingo/roslyn/csc.dll \
    LINGO_CSC_RSP=/opt/lingo/csc.rsp \
    LINGO_DOTNET_TFM=net10.0 \
    LINGO_DOTNET_VERSION=10.0.0 \
    DOTNET_CLI_TELEMETRY_OPTOUT=1 \
    DOTNET_NOLOGO=1
USER 10001:10001
EXPOSE 8080
ENTRYPOINT ["/opt/lingo/lingo-runner"]
