# Lingo code runner for Java and Kotlin. Build context: the runners folder.
# Java comes from the official Eclipse Temurin JDK image; the Kotlin compiler is the official
# release archive from JetBrains, checked against its published SHA-256.
ARG GO_VERSION=1.27.3-alpine3.24
ARG JDK_VERSION=25.0.4.1_1-jdk-noble
ARG KOTLIN_VERSION=2.4.21
ARG KOTLIN_SHA256=7cc140e76daf416a0424a5557f99afd7ca89ebd463ea1101261e3e01c33e75cd

FROM golang:${GO_VERSION} AS service
WORKDIR /src
COPY service/ ./
RUN CGO_ENABLED=0 go build -trimpath -ldflags="-s -w" -o /out/lingo-runner .

FROM eclipse-temurin:${JDK_VERSION} AS kotlin
ARG KOTLIN_VERSION
ARG KOTLIN_SHA256
ADD --checksum=sha256:${KOTLIN_SHA256} https://github.com/JetBrains/kotlin/releases/download/v${KOTLIN_VERSION}/kotlin-compiler-${KOTLIN_VERSION}.zip /tmp/kotlin.zip
RUN cd /opt && jar xf /tmp/kotlin.zip && chmod 755 /opt/kotlinc/bin/* && rm /tmp/kotlin.zip

FROM eclipse-temurin:${JDK_VERSION}
COPY --from=kotlin /opt/kotlinc /opt/kotlinc
COPY --from=service /out/lingo-runner /opt/lingo/lingo-runner
RUN useradd --uid 10001 --user-group --no-create-home --home-dir /tmp --shell /usr/sbin/nologin runner
# LINGO_CHILD_JAVA_OPTS reaches the Kotlin compiler as JAVA_OPTS (javac and java get their
# options on the command line, see runners/service/languages.go).
ENV LINGO_RUNNER_LANGUAGES=java,kotlin \
    KOTLIN_HOME=/opt/kotlinc \
    PATH=/opt/java/openjdk/bin:/opt/kotlinc/bin:/usr/local/sbin:/usr/local/bin:/usr/sbin:/usr/bin:/sbin:/bin \
    LINGO_JAVA_HEAP=256m \
    LINGO_CHILD_JAVA_OPTS="-XX:+UseSerialGC -XX:TieredStopAtLevel=1 -XX:-UsePerfData -Xshare:auto -Xmx512m"
USER 10001:10001
EXPOSE 8080
ENTRYPOINT ["/opt/lingo/lingo-runner"]
