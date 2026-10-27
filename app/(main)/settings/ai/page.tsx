import Image from "next/image";
import { redirect } from "next/navigation";

import { AiSettings } from "@/components/settings/ai-settings";
import { DEFAULT_MODELS, SUGGESTED_MODELS } from "@/lib/ai/config";
import { hasSecretKey } from "@/lib/ai/crypto";
import {
  getAiSettingsView,
  getUsageSummary,
  getVoiceSettings,
} from "@/lib/ai/service";
import { getCurrentUser } from "@/lib/auth";

export const metadata = { title: "AI settings" };

// Each account brings its own AI keys for math practice (recognition, grading, drafting).
// Keys are encrypted on the server; this page only ever receives their last four characters.
const AiSettingsPage = async () => {
  const user = await getCurrentUser();
  if (!user) redirect("/sign-in");

  const [providers, voice, usage] = await Promise.all([
    getAiSettingsView(user.id),
    getVoiceSettings(user.id),
    getUsageSummary(user.id, 30),
  ]);

  return (
    <div className="px-6 pb-10">
      <div className="mx-auto flex w-full max-w-[720px] flex-col items-center">
        <Image src="/settings.svg" alt="Settings" height={90} width={90} />
        <h1 className="my-6 text-center text-2xl font-bold text-neutral-800">
          AI settings
        </h1>
        <p className="mb-8 text-center text-lg text-muted-foreground">
          Math practice reads handwriting and explains mistakes with an AI
          provider of your choice, using your own API key.
        </p>

        <AiSettings
          providers={providers}
          voice={voice}
          usage={usage}
          canSaveKeys={hasSecretKey()}
          defaults={DEFAULT_MODELS}
          suggestions={SUGGESTED_MODELS}
        />
      </div>
    </div>
  );
};

export default AiSettingsPage;
