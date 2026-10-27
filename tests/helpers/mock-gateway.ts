// A stand-in for the voice gateway (deploy/voice) on 127.0.0.1 for tests: it checks the bearer
// token like the real gateway, answers the speech, transcription and health paths, records
// what it was asked, and can be told to fail. The "audio" it returns is a fake MP3 whose bytes
// repeat the request, so tests can tell clips apart.
import http from "node:http";
import https from "node:https";
import type { AddressInfo } from "node:net";

export type GatewayCall = {
  method: string;
  path: string;
  authorization: string | undefined;
  body: Buffer;
};

export type MockGateway = {
  url: string;
  token: string;
  calls: GatewayCall[];
  /** Calls to one path. */
  count: (path: string) => number;
  /** Status the gateway answers every request with, instead of working (0 to work normally). */
  failWith: (status: number) => void;
  /** Delay before answering, in milliseconds. */
  delay: (ms: number) => void;
  /** The text a transcription returns. */
  transcript: (text: string) => void;
  close: () => Promise<void>;
};

/** A header that makes the bytes look like an MP3 frame, followed by the request text. */
export const fakeMp3 = (text: string) =>
  Buffer.concat([Buffer.from([0xff, 0xfb, 0x90, 0x00]), Buffer.alloc(80, 0), Buffer.from(text)]);

export const startMockGateway = async (
  options: { token?: string; tls?: { key: string; cert: string } } = {}
): Promise<MockGateway> => {
  const token = options.token ?? "t".repeat(48);
  const calls: GatewayCall[] = [];
  let failStatus = 0;
  let delayMs = 0;
  let transcript = "what is the speed";

  const handler: http.RequestListener = (req, res) => {
    const chunks: Buffer[] = [];
    req.on("data", (chunk) => chunks.push(chunk));
    req.on("end", () => {
      const body = Buffer.concat(chunks);
      const path = (req.url ?? "").split("?")[0];
      calls.push({ method: req.method ?? "", path, authorization: req.headers.authorization, body });

      const send = (status: number, type: string, payload: Buffer | string) =>
        setTimeout(() => {
          if (res.destroyed) return;
          res.writeHead(status, { "content-type": type });
          res.end(payload);
        }, delayMs);

      if (req.headers.authorization !== `Bearer ${token}`) return send(401, "text/plain", "Unauthorized.");
      if (failStatus) return send(failStatus, "text/plain", "failing");
      if (req.method === "GET" && (path === "/health" || path === "/health/transcription"))
        return send(200, "application/json", '{"status":"healthy"}');
      if (req.method === "POST" && path === "/v1/audio/speech") {
        const input = JSON.parse(body.toString("utf8")) as { input?: string; voice?: string; speed?: number };
        return send(200, "audio/mpeg", fakeMp3(`${input.voice}|${input.speed}|${input.input}`));
      }
      if (req.method === "POST" && path === "/v1/audio/transcriptions")
        return send(200, "application/json", JSON.stringify({ text: ` ${transcript} ` }));
      return send(404, "text/plain", "Not found.");
    });
  };

  const server = options.tls ? https.createServer(options.tls, handler) : http.createServer(handler);
  await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", resolve));
  const port = (server.address() as AddressInfo).port;

  return {
    url: `${options.tls ? "https" : "http"}://127.0.0.1:${port}`,
    token,
    calls,
    count: (path) => calls.filter((call) => call.path === path).length,
    failWith: (status) => {
      failStatus = status;
    },
    delay: (ms) => {
      delayMs = ms;
    },
    transcript: (text) => {
      transcript = text;
    },
    close: () =>
      new Promise<void>((resolve) => {
        server.closeAllConnections?.();
        server.close(() => resolve());
      }),
  };
};
