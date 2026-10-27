import { describe, expect, it } from "vitest";

import { VoiceError } from "./errors";
import {
  MAX_SPEECH_CHARS,
  clampSpeed,
  parseLanguage,
  parseSpeechRequest,
  sniffAudio,
} from "./validate";

const bytes = (...values: number[]) => Uint8Array.from([...values, ...new Array(16).fill(0)]);
const text = (value: string) => Uint8Array.from([...value].map((c) => c.charCodeAt(0)));

describe("parseSpeechRequest", () => {
  it("accepts text with an optional voice and speed", () => {
    expect(parseSpeechRequest({ text: "Divide both sides by v." })).toEqual({
      text: "Divide both sides by v.",
      voice: null,
      speed: null,
    });
    expect(parseSpeechRequest({ text: "x", voice: "af_heart", speed: 1.25 })).toMatchObject({
      voice: "af_heart",
      speed: 1.25,
    });
    expect(parseSpeechRequest({ text: "x", voice: "af_bella+af_sky" }).voice).toBe("af_bella+af_sky");
  });

  it.each([
    ["not an object", "hello"],
    ["an array", ["hello"]],
    ["null", null],
    ["no text", {}],
    ["empty text", { text: "   " }],
    ["a number as text", { text: 5 }],
    ["a voice with a slash", { text: "x", voice: "../etc/passwd" }],
    ["a voice that is too long", { text: "x", voice: "a".repeat(65) }],
    ["a speed above the limit", { text: "x", speed: 3 }],
    ["a speed below the limit", { text: "x", speed: 0.1 }],
    ["a speed as text", { text: "x", speed: "fast" }],
  ])("refuses %s", (_, body) => {
    expect(() => parseSpeechRequest(body)).toThrow(VoiceError);
  });

  it("caps the text length with a 413", () => {
    try {
      parseSpeechRequest({ text: "a".repeat(MAX_SPEECH_CHARS + 1) });
      expect.unreachable();
    } catch (error) {
      expect(error).toBeInstanceOf(VoiceError);
      expect((error as VoiceError).status).toBe(413);
    }
    expect(parseSpeechRequest({ text: "a".repeat(MAX_SPEECH_CHARS) }).text).toHaveLength(MAX_SPEECH_CHARS);
  });
});

describe("clampSpeed", () => {
  it("keeps speeds in range with two decimals", () => {
    expect(clampSpeed(1.2345)).toBe(1.23);
    expect(clampSpeed(9)).toBe(2);
    expect(clampSpeed(0.01)).toBe(0.5);
    expect(clampSpeed(undefined)).toBe(1);
    expect(clampSpeed("1.5")).toBe(1.5);
  });
});

describe("sniffAudio", () => {
  it("recognizes the containers browsers record", () => {
    expect(sniffAudio(bytes(0x1a, 0x45, 0xdf, 0xa3))).toBe("webm");
    expect(sniffAudio(text("OggS\u0000\u0002\u0000\u0000\u0000\u0000\u0000\u0000"))).toBe("ogg");
    expect(sniffAudio(text("RIFF\u0000\u0000\u0000\u0000WAVEfmt "))).toBe("wav");
    expect(sniffAudio(text("\u0000\u0000\u0000 ftypisom\u0000\u0000\u0002\u0000"))).toBe("mp4");
    expect(sniffAudio(text("fLaC\u0000\u0000\u0000\u0010abcdefgh"))).toBe("flac");
    expect(sniffAudio(text("ID3\u0004\u0000\u0000\u0000\u0000\u0000\u0000abc"))).toBe("mp3");
    expect(sniffAudio(bytes(0xff, 0xfb, 0x90, 0x00))).toBe("mp3");
    expect(sniffAudio(bytes(0xff, 0xf1, 0x50, 0x80))).toBe("aac");
  });

  it("refuses everything else, whatever the declared type", () => {
    expect(sniffAudio(text("<html><script>alert(1)</script></html>"))).toBeNull();
    expect(sniffAudio(text("%PDF-1.7 and some more bytes"))).toBeNull();
    expect(sniffAudio(text("MZ\u0090\u0000\u0003\u0000\u0000\u0000\u0004\u0000\u0000\u0000"))).toBeNull();
    expect(sniffAudio(new Uint8Array(0))).toBeNull();
    expect(sniffAudio(bytes(0x1a))).toBeNull();
  });
});

describe("parseLanguage", () => {
  it("accepts short codes only", () => {
    expect(parseLanguage("EN")).toBe("en");
    expect(parseLanguage("fas")).toBe("fas");
    expect(parseLanguage("english")).toBeNull();
    expect(parseLanguage("e;")).toBeNull();
    expect(parseLanguage(null)).toBeNull();
  });
});
