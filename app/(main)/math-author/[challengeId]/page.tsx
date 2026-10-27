import Link from "next/link";
import { notFound, redirect } from "next/navigation";

import { AuthorLoader } from "@/components/math/author/author-loader";
import { getCurrentUser } from "@/lib/auth";
import { MathError } from "@/lib/math/service";
import { getAuthorProblem, getSolution, listSolutionVersions } from "@/lib/math/solutions";

export const metadata = { title: "Solution author" };
export const dynamic = "force-dynamic";

// Author mode for one problem's animated solution (section 5.6).
const MathAuthorProblemPage = async ({ params }: { params: Promise<{ challengeId: string }> }) => {
  const user = await getCurrentUser();
  if (!user) redirect("/sign-in");
  if (!user.isAdmin) redirect("/learn");

  const challengeId = Number((await params).challengeId);
  let problem;
  try {
    problem = await getAuthorProblem(challengeId);
  } catch (error) {
    if (error instanceof MathError) notFound();
    throw error;
  }
  const [solution, versions] = await Promise.all([getSolution(challengeId), listSolutionVersions(challengeId)]);

  return (
    <div className="px-4 pb-10 lg:px-6">
      <p className="mb-1 text-xs">
        <Link href="/math-author" className="font-bold text-sky-600 hover:underline">
          Math solutions
        </Link>
      </p>
      <h1 className="mb-4 text-2xl font-bold text-neutral-800">Solution author</h1>
      <AuthorLoader
        problem={problem}
        initial={solution ? { version: solution.version, script: solution.script } : null}
        versions={versions}
      />
    </div>
  );
};

export default MathAuthorProblemPage;
