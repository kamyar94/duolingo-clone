// The gateway's certificate authority is trusted from a file (VOICE_CA_FILE) and nothing else
// is: a gateway whose certificate is not signed by that file is refused. The test makes a
// throwaway certificate with openssl and is skipped when openssl is not installed.
import { execFileSync } from "node:child_process";
import { mkdtemp, readFile, rm } from "node:fs/promises";
import os from "node:os";
import path from "node:path";

import { afterAll, beforeAll, describe, expect, it } from "vitest";

import { startMockGateway, type MockGateway } from "@/tests/helpers/mock-gateway";

import { readVoiceConfig } from "./config";
import { VoiceError } from "./errors";
import { checkGateway, forgetGatewayHealth, synthesize } from "./gateway";

const hasOpenssl = (() => {
  try {
    execFileSync("openssl", ["version"], { stdio: "ignore" });
    return true;
  } catch {
    return false;
  }
})();

let dir = "";
let gateway: MockGateway;
let caFile = "";
let otherCaFile = "";

const certificate = (name: string) => {
  const key = path.join(dir, `${name}.key`);
  const cert = path.join(dir, `${name}.pem`);
  execFileSync(
    "openssl",
    [
      "req", "-x509", "-newkey", "ec", "-pkeyopt", "ec_paramgen_curve:prime256v1", "-nodes",
      "-keyout", key, "-out", cert, "-days", "2", "-subj", "/CN=lingo voice test",
      "-addext", "subjectAltName=IP:127.0.0.1",
    ],
    { stdio: "ignore" }
  );
  return { key, cert };
};

describe.skipIf(!hasOpenssl)("gateway over https", () => {
  beforeAll(async () => {
    dir = await mkdtemp(path.join(os.tmpdir(), "lingo-voice-tls-"));
    const served = certificate("served");
    const other = certificate("other");
    caFile = served.cert;
    otherCaFile = other.cert;
    gateway = await startMockGateway({
      tls: { key: await readFile(served.key, "utf8"), cert: await readFile(served.cert, "utf8") },
    });
  });
  afterAll(async () => {
    await gateway?.close();
    await rm(dir, { recursive: true, force: true });
  });

  const configWith = (env: Record<string, string | undefined>) => {
    const config = readVoiceConfig({ VOICE_URL: gateway.url, VOICE_TOKEN: gateway.token, ...env });
    if (!config) throw new Error("invalid test configuration");
    return config;
  };

  it("works when VOICE_CA_FILE holds the certificate that signed the gateway", async () => {
    forgetGatewayHealth();
    expect(await checkGateway(configWith({ VOICE_CA_FILE: caFile }), Date.now() + 1_000_000)).toEqual({
      speech: true,
      transcription: true,
    });
    const clip = await synthesize(configWith({ VOICE_CA_FILE: caFile }), { text: "Hello.", voice: "af_heart", speed: 1 });
    expect(clip.length).toBeGreaterThan(64);
  });

  it("refuses the gateway without the file, and with another authority's file", async () => {
    for (const env of [{}, { VOICE_CA_FILE: otherCaFile }]) {
      const error = await synthesize(configWith(env), { text: "Hello.", voice: "af_heart", speed: 1 }).then(
        () => null,
        (caught: unknown) => caught
      );
      expect(error).toBeInstanceOf(VoiceError);
      expect((error as VoiceError).status).toBe(503);
    }
  });

  it("treats an unreadable certificate file as the gateway being away", async () => {
    const error = await synthesize(configWith({ VOICE_CA_FILE: path.join(dir, "missing.pem") }), {
      text: "Hello.",
      voice: "af_heart",
      speed: 1,
    }).then(
      () => null,
      (caught: unknown) => caught
    );
    expect((error as VoiceError).status).toBe(503);
  });
});
