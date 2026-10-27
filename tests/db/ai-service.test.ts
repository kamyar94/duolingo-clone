// The server side of the AI layer against a real database and a mock provider: keys stored
// encrypted, settings shown without keys, task routing, usage records and the per-account
// limit. Skipped unless LINGO_TEST_PG_URL is set (see tests/db/migrations.test.ts).
import crypto from "node:crypto";
import path from "node:path";

import { drizzle } from "drizzle-orm/node-postgres";
import { migrate } from "drizzle-orm/node-postgres/migrator";
import pg from "pg";
import { afterAll, beforeAll, describe, expect, it } from "vitest";

import { startMockServer, type MockServer } from "@/tests/helpers/mock-http";

const adminUrl = process.env.LINGO_TEST_PG_URL;
const database = `lingo_test_ai_${process.pid}_${Date.now()}`;
const API_KEY = "sk-test-service-0123456789-LAST";

describe.skipIf(!adminUrl)("AI service", () => {
  let admin: pg.Pool;
  let pool: pg.Pool;
  let mock: MockServer;
  let service: typeof import("@/lib/ai/service");
  const saved = { ...process.env };

  beforeAll(async () => {
    admin = new pg.Pool({ connectionString: adminUrl, max: 1 });
    await admin.query(`create database "${database}"`);
    const url = new URL(adminUrl!);
    url.pathname = `/${database}`;
    pool = new pg.Pool({ connectionString: url.toString(), max: 2 });
    await migrate(drizzle(pool), {
      migrationsFolder: path.resolve(__dirname, "../../drizzle"),
    });
    await pool.query(
      "insert into users (id, username, display_name, password_hash) values ('u1', 'learner', 'Learner', 'x'), ('u2', 'other', 'Other', 'x')"
    );

    // db/drizzle.ts reads the standard PG* variables when it is first imported.
    Object.assign(process.env, {
      PGHOST: url.hostname,
      PGPORT: url.port,
      PGUSER: decodeURIComponent(url.username),
      PGPASSWORD: decodeURIComponent(url.password),
      PGDATABASE: database,
      LINGO_SECRET_KEY: crypto.randomBytes(32).toString("base64"),
      AI_RATE_PER_MINUTE: "4",
    });
    mock = await startMockServer();
    process.env.AI_ANTHROPIC_BASE_URL = mock.url;
    process.env.AI_OPENAI_BASE_URL = `${mock.url}/v1`;
    mock.reply(() => ({
      json: {
        type: "message",
        model: "claude-sonnet-5-5",
        content: [{ type: "text", text: "OK" }],
        stop_reason: "end_turn",
        usage: { input_tokens: 11, output_tokens: 2 },
      },
    }));
    service = await import("@/lib/ai/service");
  });

  afterAll(async () => {
    process.env = saved;
    await mock?.close();
    await (await import("@/db/drizzle")).default.$client.end();
    await pool?.end();
    await admin?.query(`drop database if exists "${database}" with (force)`);
    await admin?.end();
  });

  it("stores keys encrypted and never shows them again", async () => {
    await service.saveProviderKey("u1", "anthropic", ` ${API_KEY} `);
    const row = (
      await pool.query("select encrypted_key, key_last_four from user_ai_settings where user_id = 'u1'")
    ).rows[0];
    expect(row.encrypted_key).toMatch(/^v1\./);
    expect(row.encrypted_key).not.toContain(API_KEY);
    expect(row.key_last_four).toBe("LAST");

    const view = await service.getAiSettingsView("u1");
    expect(view.anthropic).toEqual({
      provider: "anthropic",
      hasKey: true,
      keyLastFour: "LAST",
      models: {},
      tasks: [],
    });
    expect(view.openai.hasKey).toBe(false);
    expect(JSON.stringify(view)).not.toContain(API_KEY);
  });

  it("runs a task with the learner's key and records the tokens", async () => {
    mock.requests.length = 0;
    const response = await service.runAiTask("u1", "grading", { prompt: "Hi" });
    expect(response.text).toBe("OK");
    expect(mock.requests[0].headers["x-api-key"]).toBe(API_KEY);
    expect((mock.requests[0].body as { model: string }).model).toBe("claude-sonnet-5-5");

    const usage = await pool.query("select provider, model, task, input_tokens, output_tokens from ai_usage");
    expect(usage.rows).toEqual([
      {
        provider: "anthropic",
        model: "claude-sonnet-5-5",
        task: "grading",
        input_tokens: 11,
        output_tokens: 2,
      },
    ]);
    const summary = await service.getUsageSummary("u1");
    expect(summary[0]).toMatchObject({ provider: "anthropic", requests: 1, inputTokens: 11 });
  });

  it("routes tasks to the chosen provider and model", async () => {
    await service.saveTaskChoices("u1", {
      grading: { provider: "anthropic", model: "claude-opus-5-5" },
      recognition: { provider: "openai", model: null },
    });
    const view = await service.getAiSettingsView("u1");
    expect(view.anthropic.tasks).toEqual(["grading"]);
    expect(view.anthropic.models).toEqual({ grading: "claude-opus-5-5" });
    expect(view.openai.tasks).toEqual(["recognition"]);

    const grading = await service.resolveTask("u1", "grading");
    expect(grading).toMatchObject({ provider: "anthropic", model: "claude-opus-5-5", apiKey: API_KEY });
    // Recognition goes to OpenAI, which has no key yet, so the saved Anthropic key serves.
    expect((await service.resolveTask("u1", "recognition")).provider).toBe("anthropic");
    await expect(service.resolveTask("u1", "recognition", "openai")).rejects.toMatchObject({
      kind: "no-key",
    });
    await expect(service.resolveTask("u2", "grading")).rejects.toMatchObject({ kind: "no-key" });
  });

  it("tests a key with a minimal request", async () => {
    const result = await service.testProviderKey("u1", "anthropic");
    expect(result).toMatchObject({ provider: "anthropic", reply: "OK" });
    const tasks = (await pool.query("select task from ai_usage order by id")).rows.map((r) => r.task);
    expect(tasks).toContain("key-test");
  });

  it("refuses a key copied into another account's row", async () => {
    await pool.query(
      "insert into user_ai_settings (user_id, provider, encrypted_key, key_last_four) select 'u2', provider, encrypted_key, key_last_four from user_ai_settings where user_id = 'u1' and provider = 'anthropic'"
    );
    await expect(service.resolveTask("u2", "grading")).rejects.toMatchObject({ kind: "config" });
  });

  it("limits AI requests per account", async () => {
    const results = [];
    for (let i = 0; i < 6; i++)
      results.push(
        await service.runAiTask("u1", "grading", { prompt: "Hi" }).then(
          () => "ok",
          (error) => error.kind
        )
      );
    expect(results).toContain("local-rate-limit");
  });

  it("deletes a key", async () => {
    await service.deleteProviderKey("u1", "anthropic");
    const view = await service.getAiSettingsView("u1");
    expect(view.anthropic).toMatchObject({ hasKey: false, keyLastFour: null, tasks: ["grading"] });
  });

  it("stores voice preferences", async () => {
    expect(await service.getVoiceSettings("u1")).toEqual({ enabled: false, voice: null, speed: 1 });
    await service.saveVoiceSettings("u1", { enabled: true, voice: "af_heart", speed: 1.25 });
    expect(await service.getVoiceSettings("u1")).toEqual({ enabled: true, voice: "af_heart", speed: 1.25 });
  });
});
