import { redirect } from "next/navigation";

import { ReviewList, type ReviewRow } from "@/components/math/review-list";
import { getCurrentUser } from "@/lib/auth";
import { listAnalysesForReview } from "@/lib/math/service";

export const metadata = { title: "Math review" };
export const dynamic = "force-dynamic";

// Authors (admin accounts) review stored step analyses, see where the automatic answer check
// and the AI disagreed, and mark good explanations as common mistakes.
const MathReviewPage = async () => {
  const user = await getCurrentUser();
  if (!user) redirect("/sign-in");
  if (!user.isAdmin) redirect("/learn");

  const items = await listAnalysesForReview(50);
  const rows: ReviewRow[] = items.map((item) => ({
    id: item.id,
    question: item.question,
    commonMistake: item.commonMistake,
    verdict: item.analysis?.verdict ?? null,
    lines: item.analysis?.lines ?? [],
    attempts: item.attempts,
    disagreements: item.disagreements,
    model: item.analysis?.model ?? null,
    updatedAt: item.updatedAt.toISOString(),
  }));

  return (
    <div className="px-6 pb-10">
      <h1 className="mb-2 text-2xl font-bold text-neutral-800">Math review</h1>
      <p className="mb-6 text-muted-foreground">
        The newest stored explanations of learners&apos; work. A common mistake is shown
        straight away to anyone whose work matches it.
      </p>
      <ReviewList rows={rows} />
    </div>
  );
};

export default MathReviewPage;
