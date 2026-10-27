"use client";

import { useState, useTransition, type ReactNode } from "react";

import { CheckCircle, KeyRound, Trash2, XCircle } from "lucide-react";
import { toast } from "sonner";

import {
  deleteAiKey,
  saveAiKey,
  saveAiTaskChoices,
  saveVoicePreferences,
  testAiKey,
} from "@/actions/ai-settings";
import { Button } from "@/components/ui/button";
import {
  BrowserFallbackToggle,
  VoiceNames,
  VoiceSampleButton,
  VoiceStatusLine,
} from "@/components/voice/voice-settings";
import { refreshVoice } from "@/components/voice/voice-store";
import type {
  ProviderSettingsView,
  UsageRow,
  VoiceSettings,
} from "@/lib/ai/service";
import {
  AI_PROVIDER_NAMES,
  AI_PROVIDERS,
  AI_TASK_LABELS,
  AI_TASKS,
  type AiProvider,
  type AiTask,
} from "@/lib/ai/types";
import { cn } from "@/lib/utils";

type AiSettingsProps = {
  providers: Record<AiProvider, ProviderSettingsView>;
  voice: VoiceSettings;
  usage: UsageRow[];
  canSaveKeys: boolean;
  defaults: Record<AiProvider, Record<AiTask, string>>;
  suggestions: Record<AiProvider, string[]>;
};

const inputClass =
  "h-11 w-full rounded-xl border-2 border-slate-200 bg-white px-3 text-sm text-neutral-700 outline-none focus:border-sky-400 disabled:bg-slate-100";

const Section = ({
  title,
  detail,
  children,
}: {
  title: string;
  detail?: string;
  children: ReactNode;
}) => (
  <section className="w-full border-t-2 py-6">
    <h2 className="text-xl font-bold text-neutral-700">{title}</h2>
    {detail && <p className="mt-1 text-sm text-muted-foreground">{detail}</p>}
    <div className="mt-4">{children}</div>
  </section>
);

type TestState = { ok: boolean; text: string } | null;

const ProviderKey = ({
  view,
  canSaveKeys,
}: {
  view: ProviderSettingsView;
  canSaveKeys: boolean;
}) => {
  const [draft, setDraft] = useState("");
  const [test, setTest] = useState<TestState>(null);
  const [pending, startTransition] = useTransition();
  const name = AI_PROVIDER_NAMES[view.provider];
  const inputId = `ai-key-${view.provider}`;

  const save = () =>
    startTransition(async () => {
      const result = await saveAiKey(view.provider, draft);
      if (!result.ok) return void toast.error(result.error);
      setDraft("");
      setTest(null);
      toast.success(`${name} key saved (ends in ${result.keyLastFour}).`);
    });

  const remove = () =>
    startTransition(async () => {
      const result = await deleteAiKey(view.provider);
      if (!result.ok) return void toast.error(result.error);
      setTest(null);
      toast.success(`${name} key deleted.`);
    });

  const runTest = () =>
    startTransition(async () => {
      setTest(null);
      const result = await testAiKey(view.provider);
      setTest(
        result.ok
          ? { ok: true, text: `Works with ${result.model}.` }
          : { ok: false, text: result.error }
      );
    });

  return (
    <div className="rounded-xl border-2 p-4">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <label htmlFor={inputId} className="font-bold text-neutral-700">
          {name}
        </label>
        <span
          className={cn(
            "flex items-center gap-x-1 text-sm",
            view.hasKey ? "text-green-600" : "text-muted-foreground"
          )}
        >
          <KeyRound className="h-4 w-4" />
          {view.hasKey
            ? `Saved key ending in ${view.keyLastFour}`
            : "No key saved"}
        </span>
      </div>

      <form
        className="mt-3 flex flex-col gap-2 sm:flex-row"
        onSubmit={(event) => {
          event.preventDefault();
          if (draft.trim()) save();
        }}
      >
        <input
          id={inputId}
          type="password"
          value={draft}
          onChange={(event) => setDraft(event.target.value)}
          placeholder={view.hasKey ? "Paste a new key to replace it" : "Paste your API key"}
          autoComplete="off"
          spellCheck={false}
          disabled={!canSaveKeys || pending}
          className={inputClass}
        />
        <Button
          type="submit"
          variant="secondary"
          disabled={!canSaveKeys || pending || !draft.trim()}
        >
          {view.hasKey ? "Replace" : "Save"}
        </Button>
      </form>

      {view.hasKey && (
        <div className="mt-3 flex flex-wrap items-center gap-2">
          <Button type="button" variant="primaryOutline" size="sm" onClick={runTest} disabled={pending}>
            Test key
          </Button>
          <Button type="button" variant="dangerOutline" size="sm" onClick={remove} disabled={pending}>
            <Trash2 className="mr-1 h-4 w-4" />
            Delete
          </Button>
          {pending && <span className="text-sm text-muted-foreground">Working...</span>}
          {test && (
            <span
              className={cn(
                "flex items-center gap-x-1 text-sm",
                test.ok ? "text-green-600" : "text-rose-600"
              )}
            >
              {test.ok ? <CheckCircle className="h-4 w-4" /> : <XCircle className="h-4 w-4" />}
              {test.text}
            </span>
          )}
        </div>
      )}
    </div>
  );
};

const TaskChoices = ({
  providers,
  defaults,
  suggestions,
}: Pick<AiSettingsProps, "providers" | "defaults" | "suggestions">) => {
  const firstWithKey = AI_PROVIDERS.find((p) => providers[p].hasKey) ?? "openai";
  const initial = Object.fromEntries(
    AI_TASKS.map((task) => {
      const provider =
        AI_PROVIDERS.find((p) => providers[p].tasks.includes(task)) ?? firstWithKey;
      return [task, { provider, model: providers[provider].models[task] ?? "" }];
    })
  ) as Record<AiTask, { provider: AiProvider; model: string }>;

  const [choices, setChoices] = useState(initial);
  const [pending, startTransition] = useTransition();

  const update = (task: AiTask, change: Partial<{ provider: AiProvider; model: string }>) =>
    setChoices((current) => {
      const next = { ...current[task], ...change };
      // A new provider starts from the model saved for it earlier, or its default.
      if (change.provider) next.model = providers[change.provider].models[task] ?? "";
      return { ...current, [task]: next };
    });

  const save = () =>
    startTransition(async () => {
      const result = await saveAiTaskChoices(choices);
      if (result.ok) toast.success("Model choices saved.");
      else toast.error(result.error);
    });

  return (
    <form
      className="flex flex-col gap-4"
      onSubmit={(event) => {
        event.preventDefault();
        save();
      }}
    >
      {AI_TASKS.map((task) => {
        const choice = choices[task];
        const listId = `ai-models-${task}`;
        return (
          <fieldset key={task} className="rounded-xl border-2 p-4">
            <legend className="px-1 font-bold text-neutral-700">
              {AI_TASK_LABELS[task].name}
            </legend>
            <p className="mb-3 text-sm text-muted-foreground">{AI_TASK_LABELS[task].detail}</p>
            <div className="flex flex-col gap-2 sm:flex-row">
              <select
                aria-label={`${AI_TASK_LABELS[task].name} provider`}
                value={choice.provider}
                onChange={(event) => update(task, { provider: event.target.value as AiProvider })}
                className={cn(inputClass, "sm:w-56")}
              >
                {AI_PROVIDERS.map((provider) => (
                  <option key={provider} value={provider}>
                    {AI_PROVIDER_NAMES[provider]}
                    {providers[provider].hasKey ? "" : " (no key)"}
                  </option>
                ))}
              </select>
              <input
                aria-label={`${AI_TASK_LABELS[task].name} model`}
                list={listId}
                value={choice.model}
                onChange={(event) => update(task, { model: event.target.value })}
                placeholder={`Default: ${defaults[choice.provider][task]}`}
                spellCheck={false}
                className={inputClass}
              />
              <datalist id={listId}>
                {suggestions[choice.provider].map((model) => (
                  <option key={model} value={model} />
                ))}
              </datalist>
            </div>
          </fieldset>
        );
      })}
      <div>
        <Button type="submit" variant="secondary" disabled={pending}>
          Save model choices
        </Button>
      </div>
    </form>
  );
};

const VoicePreferences = ({ voice }: { voice: VoiceSettings }) => {
  const [enabled, setEnabled] = useState(voice.enabled);
  const [name, setName] = useState(voice.voice ?? "");
  const [speed, setSpeed] = useState(voice.speed);
  const [pending, startTransition] = useTransition();

  const save = () =>
    startTransition(async () => {
      const result = await saveVoicePreferences({ enabled, voice: name, speed });
      if (result.ok) {
        toast.success("Voice preferences saved.");
        void refreshVoice(true);
      } else toast.error(result.error);
    });

  return (
    <form
      className="flex flex-col gap-4"
      onSubmit={(event) => {
        event.preventDefault();
        save();
      }}
    >
      <label className="flex items-center gap-x-3 text-neutral-700">
        <input
          type="checkbox"
          checked={enabled}
          onChange={(event) => setEnabled(event.target.checked)}
          className="h-5 w-5 accent-green-500"
        />
        Read explanations aloud and allow spoken questions
      </label>
      <label className="flex flex-col gap-1 text-sm font-bold text-neutral-700">
        Voice
        <input
          value={name}
          onChange={(event) => setName(event.target.value)}
          placeholder="Default voice"
          spellCheck={false}
          list="lingo-voice-names"
          className={inputClass}
        />
        <VoiceNames id="lingo-voice-names" />
      </label>
      <label className="flex flex-col gap-1 text-sm font-bold text-neutral-700">
        Speed: {speed.toFixed(2)}x
        <input
          type="range"
          min={0.5}
          max={2}
          step={0.05}
          value={speed}
          onChange={(event) => setSpeed(Number(event.target.value))}
          className="accent-green-500"
        />
      </label>
      <BrowserFallbackToggle />
      <VoiceStatusLine />
      <div className="flex flex-wrap gap-2">
        <Button type="submit" variant="secondary" disabled={pending}>
          Save voice preferences
        </Button>
        <VoiceSampleButton voice={name} speed={speed} />
      </div>
    </form>
  );
};

const UsageTable = ({ usage }: { usage: UsageRow[] }) => {
  if (!usage.length)
    return <p className="text-sm text-muted-foreground">No AI requests in the last 30 days.</p>;
  return (
    <div className="overflow-x-auto">
      <table className="w-full text-left text-sm">
        <thead className="text-muted-foreground">
          <tr>
            <th className="py-2 pr-4 font-bold">Provider</th>
            <th className="py-2 pr-4 font-bold">Model</th>
            <th className="py-2 pr-4 text-right font-bold">Requests</th>
            <th className="py-2 pr-4 text-right font-bold">Tokens in</th>
            <th className="py-2 text-right font-bold">Tokens out</th>
          </tr>
        </thead>
        <tbody className="text-neutral-700">
          {usage.map((row) => (
            <tr key={`${row.provider}:${row.model}`} className="border-t">
              <td className="py-2 pr-4">
                {AI_PROVIDER_NAMES[row.provider as AiProvider] ?? row.provider}
              </td>
              <td className="py-2 pr-4 font-mono text-xs">{row.model}</td>
              <td className="py-2 pr-4 text-right">{row.requests.toLocaleString()}</td>
              <td className="py-2 pr-4 text-right">{row.inputTokens.toLocaleString()}</td>
              <td className="py-2 text-right">{row.outputTokens.toLocaleString()}</td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
};

export const AiSettings = ({
  providers,
  voice,
  usage,
  canSaveKeys,
  defaults,
  suggestions,
}: AiSettingsProps) => (
  <div className="w-full">
    <Section
      title="API keys"
      detail="Each key is encrypted on the server and never shown again; only its last four characters are. Requests use your own provider account."
    >
      {!canSaveKeys && (
        <p className="mb-4 rounded-xl border-2 border-amber-200 bg-amber-50 px-4 py-3 text-sm text-neutral-700">
          This server has no encryption key (LINGO_SECRET_KEY) yet, so API keys
          cannot be saved. The server admin can add it.
        </p>
      )}
      <div className="flex flex-col gap-4">
        {AI_PROVIDERS.map((provider) => (
          <ProviderKey key={provider} view={providers[provider]} canSaveKeys={canSaveKeys} />
        ))}
      </div>
    </Section>

    <Section
      title="Models"
      detail="Choose a provider and a model for each task. Leave the model empty for the default shown; providers retire models over time, so any current model name can be typed."
    >
      <TaskChoices providers={providers} defaults={defaults} suggestions={suggestions} />
    </Section>

    <Section
      title="Voice"
      detail="Read-aloud and spoken questions arrive in a later update; your choices are kept for it."
    >
      <VoicePreferences voice={voice} />
    </Section>

    <Section title="Usage" detail="Tokens your requests used in the last 30 days.">
      <UsageTable usage={usage} />
    </Section>
  </div>
);
