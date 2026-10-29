"use client";

import { CheckCircle, Eye, XCircle } from "lucide-react";
import { useKey, useMedia } from "react-use";

import { Button } from "@/components/ui/button";
import { cn } from "@/lib/utils";
import { useRouter } from "next/navigation";

type FooterProps = {
  onCheck: () => void;
  status: "correct" | "wrong" | "none" | "revealed" | "completed";
  disabled?: boolean;
  lessonId?: number;
  /** "I don't know": shows the answer and marks the question for review. */
  onDontKnow?: () => void;
  dontKnowDisabled?: boolean;
};

export const Footer = ({
  onCheck,
  status,
  disabled,
  lessonId,
  onDontKnow,
  dontKnowDisabled,
}: FooterProps) => {
  const router = useRouter();

  useKey("Enter", onCheck, {}, [onCheck]);
  const isMobile = useMedia("(max-width: 1024px)");

  return (
    <footer
      className={cn(
        "h-[100px] shrink-0 border-t-2 lg:h-[140px]",
        status === "correct" && "border-transparent bg-green-100",
        status === "wrong" && "border-transparent bg-rose-100",
        status === "revealed" && "border-transparent bg-sky-100"
      )}
    >
      <div className="mx-auto flex h-full max-w-[1140px] items-center justify-between gap-x-3 px-6 lg:px-10">
        {status === "none" && onDontKnow && (
          <Button
            variant="default"
            size={isMobile ? "sm" : "lg"}
            disabled={dontKnowDisabled}
            onClick={onDontKnow}
          >
            I don&apos;t know
          </Button>
        )}

        {status === "revealed" && (
          <div className="flex items-center text-sm font-bold text-sky-600 lg:text-2xl">
            <Eye className="mr-3 h-6 w-6 shrink-0 lg:mr-4 lg:h-10 lg:w-10" />
            Marked for review
          </div>
        )}

        {status === "correct" && (
          <div className="flex items-center text-base font-bold text-green-500 lg:text-2xl">
            <CheckCircle className="mr-4 h-6 w-6 lg:h-10 lg:w-10" />
            Nicely done!
          </div>
        )}

        {status === "wrong" && (
          <div className="flex items-center text-base font-bold text-rose-500 lg:text-2xl">
            <XCircle className="mr-4 h-6 w-6 lg:h-10 lg:w-10" />
            Try again.
          </div>
        )}

        {status === "completed" && (
          <Button
            variant="default"
            size={isMobile ? "sm" : "lg"}
            onClick={() => router.push(`/lesson/${lessonId}`)}
          >
            Practice again
          </Button>
        )}

        <Button
          disabled={disabled}
          aria-disabled={disabled}
          className="ml-auto"
          onClick={onCheck}
          size={isMobile ? "sm" : "lg"}
          variant={status === "wrong" ? "danger" : "secondary"}
        >
          {status === "none" && "Check"}
          {status === "correct" && "Next"}
          {status === "wrong" && "Retry"}
          {(status === "revealed" || status === "completed") && "Continue"}
        </Button>
      </div>
    </footer>
  );
};
