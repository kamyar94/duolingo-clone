// Each adapter against a local server that answers in that provider's response format,
// reached through the AI_*_BASE_URL overrides, with the egress proxy path through a local
// forward proxy (AI_PROXY_URL).
/* eslint-disable @typescript-eslint/no-explicit-any -- request bodies are checked field by field */
import { afterAll, afterEach, beforeAll, describe, expect, it } from "vitest";

import {
  startForwardProxy,
  startMockServer,
  type MockReply,
  type MockServer,
  type RecordedRequest,
} from "@/tests/helpers/mock-http";

import { AiError } from "../errors";
import type { AiProvider, AiRequest } from "../types";

import { createAdapter } from ".";

const API_KEY = "sk-test-SECRET-0123456789-WXYZ";
const IMAGE = { mediaType: "image/png" as const, data: "iVBORw0KGgo=" };
const SCHEMA = {
  type: "object",
  properties: { answer: { type: "number" } },
  required: ["answer"],
  additionalProperties: false,
};

let mock: MockServer;
const saved = { ...process.env };

beforeAll(async () => {
  mock = await startMockServer();
  process.env.AI_OPENAI_BASE_URL = `${mock.url}/v1`;
  process.env.AI_ANTHROPIC_BASE_URL = mock.url;
  process.env.AI_GOOGLE_BASE_URL = `${mock.url}/v1beta`;
});

afterAll(async () => {
  process.env = saved;
  await mock.close();
});

afterEach(() => {
  mock.requests.length = 0;
  delete process.env.AI_PROXY_URL;
});

// ---- Response formats of each provider ----

type Fixtures = {
  success: (text: string) => MockReply;
  badKey: MockReply;
  rateLimited: MockReply;
  quota: MockReply;
  refusal: MockReply;
  cutOff: MockReply;
  usage: { inputTokens: number; outputTokens: number };
  path: (model: string) => string;
  checkRequest: (request: RecordedRequest, sent: AiRequest) => void;
};

const fixtures: Record<AiProvider, Fixtures> = {
  openai: {
    success: (text) => ({
      json: {
        id: "resp_1",
        object: "response",
        status: "completed",
        model: "gpt-6.1-sol-2026-09-01",
        output: [
          { type: "reasoning", id: "rs_1", summary: [] },
          {
            type: "message",
            id: "msg_1",
            status: "completed",
            role: "assistant",
            content: [{ type: "output_text", text, annotations: [] }],
          },
        ],
        usage: {
          input_tokens: 120,
          input_tokens_details: { cached_tokens: 0 },
          output_tokens: 30,
          output_tokens_details: { reasoning_tokens: 12 },
          total_tokens: 150,
        },
      },
    }),
    badKey: {
      status: 401,
      json: {
        error: {
          message: `Incorrect API key provided: ${API_KEY}. You can find your API key in your account.`,
          type: "invalid_request_error",
          param: null,
          code: "invalid_api_key",
        },
      },
    },
    rateLimited: {
      status: 429,
      headers: { "retry-after": "20" },
      json: {
        error: {
          message: "Rate limit reached for requests.",
          type: "requests",
          param: null,
          code: "rate_limit_exceeded",
        },
      },
    },
    quota: {
      status: 429,
      json: {
        error: {
          message: "You exceeded your current quota.",
          type: "insufficient_quota",
          param: null,
          code: "insufficient_quota",
        },
      },
    },
    refusal: {
      json: {
        status: "completed",
        model: "gpt-6.1-sol",
        output: [
          {
            type: "message",
            role: "assistant",
            content: [{ type: "refusal", refusal: "I can't help with that." }],
          },
        ],
        usage: { input_tokens: 50, output_tokens: 8 },
      },
    },
    cutOff: {
      json: {
        status: "incomplete",
        incomplete_details: { reason: "max_output_tokens" },
        model: "gpt-6.1-sol",
        output: [],
        usage: { input_tokens: 50, output_tokens: 256 },
      },
    },
    usage: { inputTokens: 120, outputTokens: 30 },
    path: () => "/v1/responses",
    checkRequest: (request, sent) => {
      expect(request.headers.authorization).toBe(`Bearer ${API_KEY}`);
      const body = request.body as Record<string, any>;
      expect(body.model).toBe(sent.model);
      expect(body.instructions).toBe(sent.system);
      expect(body.store).toBe(false);
      expect(body.max_output_tokens).toBe(1000);
      expect(body.input[0]).toEqual({ role: "user", content: "Earlier question" });
      expect(body.input[1]).toEqual({ role: "assistant", content: "Earlier answer" });
      expect(body.input[2].content).toEqual([
        { type: "input_text", text: sent.prompt },
        { type: "input_image", image_url: `data:image/png;base64,${IMAGE.data}` },
      ]);
      expect(body.text.format).toEqual({
        type: "json_schema",
        name: "math_answer",
        schema: SCHEMA,
        strict: true,
      });
    },
  },

  anthropic: {
    success: (text) => ({
      json: {
        id: "msg_1",
        type: "message",
        role: "assistant",
        model: "claude-sonnet-5-5",
        content: [
          { type: "thinking", thinking: "Let me see.", signature: "sig" },
          { type: "text", text },
        ],
        stop_reason: "end_turn",
        stop_sequence: null,
        usage: {
          input_tokens: 100,
          cache_creation_input_tokens: 0,
          cache_read_input_tokens: 20,
          output_tokens: 30,
        },
      },
    }),
    badKey: {
      status: 401,
      json: {
        type: "error",
        error: { type: "authentication_error", message: "invalid x-api-key" },
        request_id: "req_1",
      },
    },
    rateLimited: {
      status: 429,
      headers: { "retry-after": "20" },
      json: {
        type: "error",
        error: { type: "rate_limit_error", message: "Number of requests has exceeded your rate limit." },
      },
    },
    quota: {
      status: 400,
      json: {
        type: "error",
        error: {
          type: "invalid_request_error",
          message: "Your credit balance is too low to access the Anthropic API.",
        },
      },
    },
    refusal: {
      json: {
        type: "message",
        role: "assistant",
        model: "claude-sonnet-5-5",
        content: [],
        stop_reason: "refusal",
        usage: { input_tokens: 50, output_tokens: 8 },
      },
    },
    cutOff: {
      json: {
        type: "message",
        role: "assistant",
        model: "claude-sonnet-5-5",
        content: [{ type: "text", text: '{"answ' }],
        stop_reason: "max_tokens",
        usage: { input_tokens: 50, output_tokens: 256 },
      },
    },
    usage: { inputTokens: 120, outputTokens: 30 },
    path: () => "/v1/messages",
    checkRequest: (request, sent) => {
      expect(request.headers["x-api-key"]).toBe(API_KEY);
      expect(request.headers["anthropic-version"]).toBe("2023-06-01");
      expect(request.headers.authorization).toBeUndefined();
      const body = request.body as Record<string, any>;
      expect(body.model).toBe(sent.model);
      expect(body.system).toBe(sent.system);
      expect(body.max_tokens).toBe(1000);
      expect(body.messages[0]).toEqual({ role: "user", content: "Earlier question" });
      expect(body.messages[1]).toEqual({ role: "assistant", content: "Earlier answer" });
      expect(body.messages[2].content).toEqual([
        {
          type: "image",
          source: { type: "base64", media_type: "image/png", data: IMAGE.data },
        },
        { type: "text", text: sent.prompt },
      ]);
      expect(body.output_config).toEqual({
        format: { type: "json_schema", schema: SCHEMA },
      });
    },
  },

  google: {
    success: (text) => ({
      json: {
        candidates: [
          {
            content: {
              parts: [{ text: "thinking...", thought: true }, { text }],
              role: "model",
            },
            finishReason: "STOP",
            index: 0,
          },
        ],
        usageMetadata: {
          promptTokenCount: 120,
          candidatesTokenCount: 18,
          thoughtsTokenCount: 12,
          totalTokenCount: 150,
        },
        modelVersion: "gemini-3.8-flash",
        responseId: "abc",
      },
    }),
    badKey: {
      status: 400,
      json: {
        error: {
          code: 400,
          message: "API key not valid. Please pass a valid API key.",
          status: "INVALID_ARGUMENT",
          details: [
            {
              "@type": "type.googleapis.com/google.rpc.ErrorInfo",
              reason: "API_KEY_INVALID",
              domain: "googleapis.com",
            },
          ],
        },
      },
    },
    rateLimited: {
      status: 429,
      headers: { "retry-after": "20" },
      json: {
        error: {
          code: 429,
          message: "Resource has been exhausted (e.g. check quota).",
          status: "RESOURCE_EXHAUSTED",
        },
      },
    },
    quota: {
      status: 403,
      json: {
        error: {
          code: 403,
          message: "Billing is not enabled for this project.",
          status: "PERMISSION_DENIED",
        },
      },
    },
    refusal: {
      json: {
        promptFeedback: { blockReason: "SAFETY" },
        usageMetadata: { promptTokenCount: 50, totalTokenCount: 50 },
      },
    },
    cutOff: {
      json: {
        candidates: [
          {
            content: { parts: [{ text: '{"answ' }], role: "model" },
            finishReason: "MAX_TOKENS",
          },
        ],
        usageMetadata: { promptTokenCount: 50, candidatesTokenCount: 256 },
      },
    },
    usage: { inputTokens: 120, outputTokens: 30 },
    path: (model) => `/v1beta/models/${model}:generateContent`,
    checkRequest: (request, sent) => {
      expect(request.headers["x-goog-api-key"]).toBe(API_KEY);
      expect(request.url).not.toContain(API_KEY);
      const body = request.body as Record<string, any>;
      expect(body.systemInstruction).toEqual({ parts: [{ text: sent.system }] });
      expect(body.contents[0]).toEqual({
        role: "user",
        parts: [{ text: "Earlier question" }],
      });
      expect(body.contents[1]).toEqual({
        role: "model",
        parts: [{ text: "Earlier answer" }],
      });
      expect(body.contents[2].parts).toEqual([
        { text: sent.prompt },
        { inlineData: { mimeType: "image/png", data: IMAGE.data } },
      ]);
      expect(body.generationConfig).toEqual({
        maxOutputTokens: 1000,
        responseMimeType: "application/json",
        responseJsonSchema: SCHEMA,
      });
    },
  },
};

const MODELS: Record<AiProvider, string> = {
  openai: "gpt-6.1-sol",
  anthropic: "claude-sonnet-5-5",
  google: "gemini-3.8-flash",
};

const fullRequest = (provider: AiProvider): AiRequest => ({
  model: MODELS[provider],
  system: "You grade algebra.",
  history: [
    { role: "user", text: "Earlier question" },
    { role: "assistant", text: "Earlier answer" },
  ],
  prompt: "Read this line.",
  images: [IMAGE],
  json: { name: "math answer", schema: SCHEMA },
  maxOutputTokens: 1000,
});

const failure = async (promise: Promise<unknown>) => {
  try {
    await promise;
  } catch (error) {
    return error as AiError;
  }
  throw new Error("expected a failure");
};

describe.each(["openai", "anthropic", "google"] as const)("%s adapter", (provider) => {
  const f = fixtures[provider];
  const adapter = () => createAdapter(provider, { apiKey: API_KEY });

  it("sends the request in the provider's format and parses JSON and usage", async () => {
    mock.reply(() => f.success('{"answer": 3}'));
    const sent = fullRequest(provider);
    const response = await adapter().send(sent);

    expect(mock.requests).toHaveLength(1);
    expect(mock.requests[0].method).toBe("POST");
    expect(mock.requests[0].url).toBe(f.path(MODELS[provider]));
    f.checkRequest(mock.requests[0], sent);

    expect(response.provider).toBe(provider);
    expect(response.json).toEqual({ answer: 3 });
    expect(response.text).toBe('{"answer": 3}');
    expect(response.usage).toEqual(f.usage);
  });

  it("returns plain text when no schema was asked for", async () => {
    mock.reply(() => f.success("OK"));
    const response = await adapter().send({ model: MODELS[provider], prompt: "Say OK" });
    expect(response.text).toBe("OK");
    expect(response.json).toBeUndefined();
  });

  it("reports a refused key without repeating it", async () => {
    mock.reply(() => f.badKey);
    const error = await failure(adapter().send({ model: MODELS[provider], prompt: "x" }));
    expect(error).toBeInstanceOf(AiError);
    expect(error.kind).toBe("auth");
    expect(error.provider).toBe(provider);
    expect(error.message).not.toContain(API_KEY);
    expect(JSON.stringify(error)).not.toContain(API_KEY);
  });

  it("reports the provider's rate limit with its wait time", async () => {
    mock.reply(() => f.rateLimited);
    const error = await failure(adapter().send({ model: MODELS[provider], prompt: "x" }));
    expect(error.kind).toBe("rate-limit");
    expect(error.retryAfter).toBe(20);
    expect(error.status).toBe(429);
  });

  it("tells an empty account apart from a bad request", async () => {
    mock.reply(() => f.quota);
    const error = await failure(adapter().send({ model: MODELS[provider], prompt: "x" }));
    expect(error.kind).toBe(provider === "google" ? "auth" : "quota");
  });

  it("reports a refusal and keeps the tokens it cost", async () => {
    mock.reply(() => f.refusal);
    const error = await failure(adapter().send({ model: MODELS[provider], prompt: "x" }));
    expect(error.kind).toBe("refusal");
    expect(error.usage?.inputTokens).toBe(50);
  });

  it("reports a reply cut off by the token limit", async () => {
    mock.reply(() => f.cutOff);
    const error = await failure(
      adapter().send({ model: MODELS[provider], prompt: "x", json: { name: "a", schema: SCHEMA } })
    );
    expect(error.kind).toBe("incomplete");
    expect(error.usage?.outputTokens).toBe(256);
  });

  it("reports JSON that does not parse, with its usage", async () => {
    mock.reply(() => f.success("not json"));
    const error = await failure(
      adapter().send({ model: MODELS[provider], prompt: "x", json: { name: "a", schema: SCHEMA } })
    );
    expect(error.kind).toBe("invalid-output");
    expect(error.usage).toEqual(f.usage);
  });

  it("maps provider failures to server errors", async () => {
    mock.reply(() => ({ status: 500, text: "upstream exploded" }));
    const error = await failure(adapter().send({ model: MODELS[provider], prompt: "x" }));
    expect(error.kind).toBe("server");
  });

  it("goes through the egress proxy when AI_PROXY_URL is set", async () => {
    const proxy = await startForwardProxy();
    try {
      process.env.AI_PROXY_URL = proxy.url;
      mock.reply(() => f.success("OK"));
      const response = await adapter().send({ model: MODELS[provider], prompt: "x" });
      expect(response.text).toBe("OK");
      expect(proxy.seen).toEqual([`${mock.url}${f.path(MODELS[provider])}`]);
    } finally {
      await proxy.close();
    }
  });
});

describe("network failures", () => {
  it("reports an unreachable provider and a timeout", async () => {
    const unreachable = createAdapter("openai", {
      apiKey: API_KEY,
      baseUrl: "http://127.0.0.1:9",
    });
    expect((await failure(unreachable.send({ model: "m", prompt: "x" }))).kind).toBe(
      "network"
    );

    mock.reply(() => ({ ...fixtures.anthropic.success("late"), delayMs: 1000 }));
    const slow = createAdapter("anthropic", { apiKey: API_KEY, timeoutMs: 200 });
    expect((await failure(slow.send({ model: "m", prompt: "x" }))).kind).toBe(
      "timeout"
    );
  });

  it("refuses to use a proxy that is down instead of going direct", async () => {
    process.env.AI_PROXY_URL = "http://127.0.0.1:9";
    mock.reply(() => fixtures.openai.success("OK"));
    const error = await failure(
      createAdapter("openai", { apiKey: API_KEY }).send({ model: "m", prompt: "x" })
    );
    expect(error.kind).toBe("network");
    expect(mock.requests).toHaveLength(0);
  });
});
