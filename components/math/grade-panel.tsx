"use client";

// The result of a check (section 5.4): the deterministic verdict, the AI step analysis with
// the first wrong line, its kind and a hint, where the analysis came from, follow-up questions
// typed by the learner, and for authors a switch that marks the analysis as a common mistake.
import { useState } from "react";

import Link from "next/link";
import {
  CircleCheck,
  CircleX,
  LoaderCircle,
  MessageCircleQuestion,
  Send,
  Star,
  TriangleAlert,
} from "lucide-react";

import { AI_PROVIDER_NAMES, isAiProvider } from "@/lib/ai/types";
import type { ConversationTurn, GradeResult } from "@/lib/math/types";
import { cn } from "@/lib/utils";

import { MicButton } from "@/components/voice/mic-button";
import { PlayButton } from "@/components/voice/play-button";
import { VoiceNote } from "@/components/voice/voice-note";

import { askFollowUp, markCommonMistake, MathApiError } from "./api";
import { MathFormula, MathText } from "./math-text";
import { SolutionButton } from "./solution/solution-button";

const providerName = (provider: string | null) =>
  provider && isAiProvider(provider) ? AI_PROVIDER_NAMES[provider] : provider ?? "";

const SourceNote = ({ result }: { result: GradeResult }) => {
  if (result.analysisSource === "common")
    return (
      <p className="flex items-center gap-1 text-xs font-bold text-amber-600">
        <Star className="h-3.5 w-3.5" /> A common mistake, explained by an author. No AI call
        was needed.
      </p>
    );
  if (result.analysisSource === "stored")
    return (
      <p className="text-xs text-neutral-500">
        The same work was explained before, so this answer came from the saved analysis without
        an AI call.
      </p>
    );
  if (result.analysisSource === "ai")
    return (
      <p className="text-xs text-neutral-500">
        Explained by {providerName(result.provider)}
        {result.model ? ` (${result.model})` : ""}.
      </p>
    );
  return null;
};

type GradePanelProps = {
  challengeId: number;
  result: GradeResult;
  lines: string[];
  /** True once the learner retries: the panel shows the last check, dimmed. */
  stale: boolean;
  onResult: (result: GradeResult) => void;
};

export const GradePanel = ({ challengeId, result, lines, stale, onResult }: GradePanelProps) => {
  const { analysis, check } = result;
  const [question, setQuestion] = useState("");
  const [conversation, setConversation] = useState<ConversationTurn[]>([]);
  const [asking, setAsking] = useState(false);
  const [askError, setAskError] = useState<string | null>(null);
  const [promoting, setPromoting] = useState(false);

  const ask = async () => {
    const text = question.trim();
    if (!text || asking) return;
    setAsking(true);
    setAskError(null);
    try {
      const reply = await askFollowUp({ attemptId: result.attemptId, question: text });
      setConversation(reply.conversation);
      setQuestion("");
    } catch (error) {
      setAskError(error instanceof MathApiError ? error.message : "The question could not be sent.");
    } finally {
      setAsking(false);
    }
  };

  const promote = async () => {
    if (!result.analysisId || promoting) return;
    setPromoting(true);
    try {
      const row = await markCommonMistake(result.analysisId, !result.commonMistake);
      onResult({ ...result, commonMistake: row.commonMistake });
    } catch {
      // The button stays as it was.
    } finally {
      setPromoting(false);
    }
  };

  const wrongLine = analysis && analysis.firstWrongLine > 0 ? lines[analysis.firstWrongLine - 1] : null;

  return (
    <section
      aria-live="polite"
      className={cn(
        "space-y-3 rounded-xl border-2 px-4 py-3",
        result.correct ? "border-green-200 bg-green-50" : "border-rose-200 bg-rose-50",
        stale && "opacity-70"
      )}
    >
      <div className="flex items-start gap-2">
        {result.correct ? (
          <CircleCheck className="mt-0.5 h-5 w-5 shrink-0 text-green-500" />
        ) : (
          <CircleX className="mt-0.5 h-5 w-5 shrink-0 text-rose-500" />
        )}
        <div className="space-y-1 text-sm text-neutral-700 lg:text-base">
          <p className="font-bold">
            {stale ? "Last check: " : ""}
            {result.correct ? "Your answer is right." : "Your answer is not right yet."}
          </p>
          <p>
            {check.detail}
            {check.read && (
              <>
                {" "}
                Read as <MathFormula latex={check.read} />.
              </>
            )}
          </p>
        </div>
      </div>

      {analysis && (
        <div className="space-y-2 rounded-lg bg-white/70 px-3 py-2 text-sm text-neutral-700 lg:text-base">
          {analysis.firstWrongLine > 0 && (
            <p>
              <span className="font-bold text-rose-600">Line {analysis.firstWrongLine}</span>
              {wrongLine && (
                <>
                  : <MathFormula latex={wrongLine} />
                </>
              )}
              {analysis.mistakeType !== "none" && (
                <span className="ml-2 rounded-full bg-rose-100 px-2 py-0.5 text-xs font-bold text-rose-600">
                  {analysis.mistakeType}
                </span>
              )}
            </p>
          )}
          <div className="flex items-start gap-1">
            <MathText text={analysis.explanation} className="flex-1" />
            <PlayButton text={analysis.explanation} what="the explanation" />
          </div>
          {analysis.correctedLine && (
            <p>
              <span className="font-bold">It should read:</span>{" "}
              <MathFormula latex={analysis.correctedLine} />
            </p>
          )}
          {analysis.nextHint && (
            <div className="text-neutral-600">
              <span className="font-bold">Next step: </span>
              <MathText text={analysis.nextHint} className="inline-block" />
            </div>
          )}
          <SourceNote result={result} />
        </div>
      )}

      {result.disagreement && (
        <p className="flex items-start gap-2 text-xs text-amber-700">
          <TriangleAlert className="mt-0.5 h-4 w-4 shrink-0" />
          The automatic check of the final answer and the AI explanation disagree. The automatic
          check counts, and the difference was recorded for review.
        </p>
      )}

      {result.analysisError && (
        <p className="flex items-start gap-2 text-xs text-amber-700">
          <TriangleAlert className="mt-0.5 h-4 w-4 shrink-0" />
          <span>
            No explanation this time: {result.analysisError}{" "}
            <Link href="/settings/ai" className="font-bold underline">
              AI settings
            </Link>
          </span>
        </p>
      )}

      <SolutionButton challengeId={challengeId} analysis={analysis} lines={lines} />

      {result.canPromote && (
        <button
          type="button"
          onClick={promote}
          disabled={promoting}
          className="flex items-center gap-1 text-xs font-bold text-amber-700 hover:underline disabled:opacity-50"
        >
          <Star className={cn("h-3.5 w-3.5", result.commonMistake && "fill-amber-400")} />
          {result.commonMistake
            ? "Marked as a common mistake of this problem (tap to remove)"
            : "Mark this explanation as a common mistake of this problem"}
        </button>
      )}

      {analysis && (
        <div className="space-y-2 border-t-2 border-white/80 pt-2">
          {conversation.map((turn, n) => (
            <div
              key={n}
              className={cn(
                "rounded-lg px-3 py-2 text-sm",
                turn.role === "user" ? "ml-8 bg-sky-100 text-sky-900" : "mr-8 bg-white text-neutral-700"
              )}
            >
              {turn.role === "user" ? (
                turn.text
              ) : (
                <div className="flex items-start gap-1">
                  <MathText text={turn.text} className="flex-1" />
                  <PlayButton text={turn.text} what="the answer" note={false} />
                </div>
              )}
            </div>
          ))}
          <form
            className="flex items-end gap-2"
            onSubmit={(event) => {
              event.preventDefault();
              void ask();
            }}
          >
            <label className="flex-1">
              <span className="mb-1 flex items-center gap-1 text-xs font-bold text-neutral-500">
                <MessageCircleQuestion className="h-3.5 w-3.5" /> Ask about this explanation
              </span>
              <textarea
                value={question}
                onChange={(event) => setQuestion(event.target.value)}
                onKeyDown={(event) => {
                  if (event.key === "Enter" && !event.shiftKey) {
                    event.preventDefault();
                    void ask();
                  }
                }}
                maxLength={1000}
                rows={1}
                placeholder="Why does the sign change?"
                className="w-full resize-none rounded-lg border-2 border-slate-200 bg-white px-3 py-2 text-sm focus:border-sky-400 focus:outline-none"
              />
            </label>
            <MicButton
              disabled={asking}
              onTranscript={(spoken) =>
                setQuestion((current) => (current.trim() ? `${current.trim()} ${spoken}` : spoken).slice(0, 1000))
              }
            />
            <button
              type="submit"
              disabled={asking || !question.trim()}
              aria-label="Send the question"
              className="flex h-10 w-10 shrink-0 items-center justify-center rounded-lg bg-sky-400 text-white disabled:opacity-40"
            >
              {asking ? <LoaderCircle className="h-4 w-4 animate-spin" /> : <Send className="h-4 w-4" />}
            </button>
          </form>
          {askError && <p className="text-xs text-rose-600">{askError}</p>}
          <VoiceNote />
        </div>
      )}
    </section>
  );
};
