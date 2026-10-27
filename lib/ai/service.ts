// Server side of the AI layer: the learner's stored settings, key encryption, the per-account
// rate limit, the provider call and the token record. Pages and server actions call this; the
// math and coding features call runAiTask. Never import it into a client component.
import { and, desc, eq, gte, sql } from "drizzle-orm";

import db from "@/db/drizzle";
import { aiUsage, userAiSettings, userVoiceSettings } from "@/db/schema";

import { createAdapter } from "./adapters";
import { DEFAULT_MODELS, isValidModelName } from "./config";
import { decryptSecret, encryptSecret, keyContext, lastFour } from "./crypto";
import { AiError, isAiError } from "./errors";
import { aiRateLimiter } from "./rate-limit";
import {
  AI_PROVIDERS,
  AI_TASKS,
  isAiProvider,
  isAiTask,
  type AiProvider,
  type AiRequest,
  type AiResponse,
  type AiTask,
  type AiUsage,
} from "./types";

export type TaskModels = Partial<Record<AiTask, string>>;

export type ProviderSettingsView = {
  provider: AiProvider;
  hasKey: boolean;
  keyLastFour: string | null;
  models: TaskModels;
  tasks: AiTask[];
};

const cleanModels = (value: unknown): TaskModels => {
  const models: TaskModels = {};
  if (typeof value !== "object" || value === null) return models;
  for (const [task, model] of Object.entries(value))
    if (isAiTask(task) && typeof model === "string" && isValidModelName(model))
      models[task] = model;
  return models;
};

const rowsFor = (userId: string) =>
  db.query.userAiSettings.findMany({ where: eq(userAiSettings.userId, userId) });

/** What the settings page may show: never the key, only whether one is saved and its end. */
export const getAiSettingsView = async (
  userId: string
): Promise<Record<AiProvider, ProviderSettingsView>> => {
  const rows = await rowsFor(userId);
  const view = {} as Record<AiProvider, ProviderSettingsView>;
  for (const provider of AI_PROVIDERS) {
    const row = rows.find((r) => r.provider === provider);
    view[provider] = {
      provider,
      hasKey: !!row?.encryptedKey,
      keyLastFour: row?.encryptedKey ? row.keyLastFour : null,
      models: cleanModels(row?.models),
      tasks: (row?.tasks ?? []).filter(isAiTask),
    };
  }
  return view;
};

export const saveProviderKey = async (
  userId: string,
  provider: AiProvider,
  apiKey: string
) => {
  const key = apiKey.trim();
  const encryptedKey = encryptSecret(key, keyContext(userId, provider));
  await db
    .insert(userAiSettings)
    .values({ userId, provider, encryptedKey, keyLastFour: lastFour(key) })
    .onConflictDoUpdate({
      target: [userAiSettings.userId, userAiSettings.provider],
      set: { encryptedKey, keyLastFour: lastFour(key), updatedAt: new Date() },
    });
};

export const deleteProviderKey = async (userId: string, provider: AiProvider) => {
  await db
    .update(userAiSettings)
    .set({ encryptedKey: null, keyLastFour: null, updatedAt: new Date() })
    .where(
      and(eq(userAiSettings.userId, userId), eq(userAiSettings.provider, provider))
    );
};

export type TaskChoice = { provider: AiProvider; model: string | null };

/**
 * Saves which provider handles each task and with which model (null for the default). Every
 * task belongs to at most one provider; a provider keeps the model names of tasks it no longer
 * handles, so switching back restores them.
 */
export const saveTaskChoices = async (
  userId: string,
  choices: Partial<Record<AiTask, TaskChoice>>
) => {
  const rows = await rowsFor(userId);
  await db.transaction(async (tx) => {
    for (const provider of AI_PROVIDERS) {
      const row = rows.find((r) => r.provider === provider);
      const models = cleanModels(row?.models);
      const tasks: AiTask[] = [];
      for (const task of AI_TASKS) {
        const choice = choices[task];
        if (choice?.provider !== provider) continue;
        tasks.push(task);
        if (choice.model && isValidModelName(choice.model)) models[task] = choice.model;
        else delete models[task];
      }
      if (!row && !tasks.length) continue;
      await tx
        .insert(userAiSettings)
        .values({ userId, provider, models, tasks })
        .onConflictDoUpdate({
          target: [userAiSettings.userId, userAiSettings.provider],
          set: { models, tasks, updatedAt: new Date() },
        });
    }
  });
};

export type ResolvedTask = { provider: AiProvider; model: string; apiKey: string };

/**
 * The provider, model and decrypted key for a task. Uses the provider chosen for the task, or,
 * when none was chosen, the first provider with a saved key.
 */
export const resolveTask = async (
  userId: string,
  task: AiTask,
  provider?: AiProvider
): Promise<ResolvedTask> => {
  const rows = await rowsFor(userId);
  const row = provider
    ? rows.find((r) => r.provider === provider)
    : (rows.find((r) => r.tasks.includes(task) && r.encryptedKey) ??
      AI_PROVIDERS.map((p) => rows.find((r) => r.provider === p)).find(
        (r) => r?.encryptedKey
      ));

  if (!row || !isAiProvider(row.provider) || !row.encryptedKey)
    throw new AiError("no-key", "No API key is saved for this task.", { provider });

  let apiKey: string;
  try {
    apiKey = decryptSecret(row.encryptedKey, keyContext(userId, row.provider));
  } catch (error) {
    if (isAiError(error)) throw error;
    throw new AiError(
      "config",
      "A saved key could not be decrypted; LINGO_SECRET_KEY may have changed. Save the key again.",
      { provider: row.provider }
    );
  }

  const model =
    cleanModels(row.models)[task] ?? DEFAULT_MODELS[row.provider][task];
  return { provider: row.provider, model, apiKey };
};

export const recordAiUsage = async (entry: {
  userId: string;
  provider: AiProvider;
  model: string;
  task: string;
  usage: AiUsage;
}) => {
  await db.insert(aiUsage).values({
    userId: entry.userId,
    provider: entry.provider,
    model: entry.model,
    task: entry.task,
    inputTokens: Math.round(entry.usage.inputTokens),
    outputTokens: Math.round(entry.usage.outputTokens),
  });
};

/** Throws AiError("local-rate-limit") when the account made too many AI requests. */
export const takeAiRequest = (userId: string) => {
  const { ok, retryAfter } = aiRateLimiter.take(userId);
  if (!ok)
    throw new AiError("local-rate-limit", "Too many AI requests.", { retryAfter });
};

/**
 * Sends one request for a task with the learner's own provider, model and key, counts it
 * against the per-account limit and records the tokens used, also when the reply was unusable.
 */
export const runAiTask = async (
  userId: string,
  task: AiTask,
  request: Omit<AiRequest, "model"> & { model?: string },
  options: { provider?: AiProvider; usageTask?: string } = {}
): Promise<AiResponse> => {
  takeAiRequest(userId);
  const resolved = await resolveTask(userId, task, options.provider);
  const model = request.model ?? resolved.model;
  const adapter = createAdapter(resolved.provider, { apiKey: resolved.apiKey });
  const record = (usage: AiUsage) =>
    recordAiUsage({
      userId,
      provider: resolved.provider,
      model,
      task: options.usageTask ?? task,
      usage,
    }).catch(() => undefined);

  try {
    const response = await adapter.send({ ...request, model });
    await record(response.usage);
    return response;
  } catch (error) {
    if (isAiError(error) && error.usage) await record(error.usage);
    throw error;
  }
};

/**
 * Checks a saved key with a minimal request to the model chosen for recognition (or that
 * provider's default). The reply text does not matter; an accepted request proves the key,
 * the model name and the route through the egress proxy.
 */
export const testProviderKey = async (userId: string, provider: AiProvider) => {
  const { model } = await resolveTask(userId, "recognition", provider);
  const response = await runAiTask(
    userId,
    "recognition",
    { model, prompt: "Reply with the single word OK.", maxOutputTokens: 256 },
    { provider, usageTask: "key-test" }
  ).catch((error) => {
    // Cut off by the small token limit still means the key and model work.
    if (isAiError(error) && error.kind === "incomplete") return null;
    throw error;
  });
  return {
    provider,
    model,
    reply: response?.text.slice(0, 80) ?? "",
    usage: response?.usage ?? null,
  };
};

export type UsageRow = {
  provider: string;
  model: string;
  requests: number;
  inputTokens: number;
  outputTokens: number;
};

/** Tokens per provider and model over the last days, newest use first. */
export const getUsageSummary = async (userId: string, days = 30) => {
  const since = new Date(Date.now() - days * 86_400_000);
  const rows = await db
    .select({
      provider: aiUsage.provider,
      model: aiUsage.model,
      requests: sql<number>`count(*)::int`,
      inputTokens: sql<number>`coalesce(sum(${aiUsage.inputTokens}), 0)::int`,
      outputTokens: sql<number>`coalesce(sum(${aiUsage.outputTokens}), 0)::int`,
      lastUsed: sql<Date>`max(${aiUsage.createdAt})`,
    })
    .from(aiUsage)
    .where(and(eq(aiUsage.userId, userId), gte(aiUsage.createdAt, since)))
    .groupBy(aiUsage.provider, aiUsage.model)
    .orderBy(desc(sql`max(${aiUsage.createdAt})`));
  return rows.map(
    ({ provider, model, requests, inputTokens, outputTokens }): UsageRow => ({
      provider,
      model,
      requests,
      inputTokens,
      outputTokens,
    })
  );
};

export type VoiceSettings = { enabled: boolean; voice: string | null; speed: number };

export const DEFAULT_VOICE_SETTINGS: VoiceSettings = {
  enabled: false,
  voice: null,
  speed: 1,
};

export const getVoiceSettings = async (userId: string): Promise<VoiceSettings> => {
  const row = await db.query.userVoiceSettings.findFirst({
    where: eq(userVoiceSettings.userId, userId),
  });
  return row
    ? { enabled: row.enabled, voice: row.voice, speed: row.speed }
    : DEFAULT_VOICE_SETTINGS;
};

export const saveVoiceSettings = async (userId: string, settings: VoiceSettings) => {
  await db
    .insert(userVoiceSettings)
    .values({ userId, ...settings })
    .onConflictDoUpdate({
      target: userVoiceSettings.userId,
      set: { ...settings, updatedAt: new Date() },
    });
};
