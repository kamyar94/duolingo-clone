"use server";

import { revalidatePath } from "next/cache";

import { isValidModelName } from "@/lib/ai/config";
import { hasSecretKey } from "@/lib/ai/crypto";
import { describeAiError, isAiError } from "@/lib/ai/errors";
import { aiSettingsRateLimiter } from "@/lib/ai/rate-limit";
import {
  deleteProviderKey,
  saveProviderKey,
  saveTaskChoices,
  saveVoiceSettings,
  testProviderKey,
  type TaskChoice,
} from "@/lib/ai/service";
import { AI_TASKS, isAiProvider, type AiTask } from "@/lib/ai/types";
import { auth } from "@/lib/auth";

// Server actions of the AI settings page (/settings/ai). A key travels from the browser to the
// server once, is encrypted there and never comes back; replies carry only its last four
// characters. Nothing here logs keys or request bodies.

type Result<T = object> = ({ ok: true } & T) | { ok: false; error: string };

const PAGE = "/settings/ai";

const signedIn = async () => {
  const { userId } = await auth();
  if (!userId) throw new Error("Unauthorized.");
  return userId;
};

const limited = (userId: string): { ok: false; error: string } | null => {
  const { ok, retryAfter } = aiSettingsRateLimiter.take(userId);
  return ok
    ? null
    : {
        ok: false,
        error: `Too many changes in a short time. Try again in ${Math.ceil(retryAfter / 60)} minute(s).`,
      };
};

// Keys of all three providers are printable ASCII without spaces.
const looksLikeKey = (value: string) => /^[\x21-\x7e]{8,512}$/.test(value);

export const saveAiKey = async (
  provider: string,
  apiKey: string
): Promise<Result<{ keyLastFour: string }>> => {
  const userId = await signedIn();
  if (!isAiProvider(provider)) return { ok: false, error: "Unknown provider." };
  const key = typeof apiKey === "string" ? apiKey.trim() : "";
  if (!looksLikeKey(key))
    return { ok: false, error: "That does not look like an API key." };
  if (!hasSecretKey())
    return {
      ok: false,
      error: "This server has no LINGO_SECRET_KEY yet, so keys cannot be saved.",
    };
  const refused = limited(userId);
  if (refused) return refused;

  await saveProviderKey(userId, provider, key);
  revalidatePath(PAGE);
  return { ok: true, keyLastFour: key.slice(-4) };
};

export const deleteAiKey = async (provider: string): Promise<Result> => {
  const userId = await signedIn();
  if (!isAiProvider(provider)) return { ok: false, error: "Unknown provider." };
  const refused = limited(userId);
  if (refused) return refused;

  await deleteProviderKey(userId, provider);
  revalidatePath(PAGE);
  return { ok: true };
};

export const testAiKey = async (
  provider: string
): Promise<Result<{ model: string; reply: string }>> => {
  const userId = await signedIn();
  if (!isAiProvider(provider)) return { ok: false, error: "Unknown provider." };
  const refused = limited(userId);
  if (refused) return refused;

  try {
    const result = await testProviderKey(userId, provider);
    revalidatePath(PAGE);
    return { ok: true, model: result.model, reply: result.reply };
  } catch (error) {
    if (!isAiError(error)) throw error;
    return { ok: false, error: describeAiError(error) };
  }
};

export const saveAiTaskChoices = async (
  choices: Record<string, { provider: string; model: string }>
): Promise<Result> => {
  const userId = await signedIn();
  const clean: Partial<Record<AiTask, TaskChoice>> = {};
  for (const task of AI_TASKS) {
    const choice = choices?.[task];
    if (!choice || !isAiProvider(choice.provider)) continue;
    const model = typeof choice.model === "string" ? choice.model.trim() : "";
    if (model && !isValidModelName(model))
      return {
        ok: false,
        error: `"${model.slice(0, 40)}" is not a model name (letters, digits, dot, dash, underscore).`,
      };
    clean[task] = { provider: choice.provider, model: model || null };
  }

  await saveTaskChoices(userId, clean);
  revalidatePath(PAGE);
  return { ok: true };
};

export const saveVoicePreferences = async (settings: {
  enabled: boolean;
  voice: string;
  speed: number;
}): Promise<Result> => {
  const userId = await signedIn();
  const voice = typeof settings?.voice === "string" ? settings.voice.trim() : "";
  if (voice && !/^[A-Za-z0-9_.+-]{1,64}$/.test(voice))
    return { ok: false, error: "A voice name uses letters, digits, dot, dash, plus or underscore." };
  const speed = Number(settings?.speed);
  if (!Number.isFinite(speed) || speed < 0.5 || speed > 2)
    return { ok: false, error: "Speed must be between 0.5 and 2." };

  await saveVoiceSettings(userId, {
    enabled: settings.enabled === true,
    voice: voice || null,
    speed: Math.round(speed * 100) / 100,
  });
  revalidatePath(PAGE);
  return { ok: true };
};
