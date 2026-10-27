import Link from "next/link";
import { redirect } from "next/navigation";

import { getCurrentUser } from "@/lib/auth";
import { listMathProblems } from "@/lib/math/solutions";

export const metadata = { title: "Math solutions" };
export const dynamic = "force-dynamic";

// Authors (admin accounts) pick a math problem to write or change its animated solution
// (docs/DESIGN-coding-and-math.md, section 5.6).
const MathAuthorPage = async () => {
  const user = await getCurrentUser();
  if (!user) redirect("/sign-in");
  if (!user.isAdmin) redirect("/learn");

  const problems = await listMathProblems();

  return (
    <div className="px-6 pb-10">
      <h1 className="mb-2 text-2xl font-bold text-neutral-800">Math solutions</h1>
      <p className="mb-6 text-muted-foreground">
        Every math problem with the versions of its animated solution. Open one to write a
        solution, change it, or draft one with your AI provider.{" "}
        <Link href="/math-review" className="font-bold text-sky-600 hover:underline">
          Review stored explanations
        </Link>
      </p>
      {problems.length === 0 && <p className="text-neutral-500">No math problems yet. Import a course with MATH challenges first.</p>}
      <ul className="divide-y-2 divide-slate-100 rounded-xl border-2 border-slate-200 bg-white">
        {problems.map((problem) => (
          <li key={problem.id}>
            <Link href={`/math-author/${problem.id}`} className="flex items-center gap-3 px-4 py-3 hover:bg-slate-50">
              <div className="min-w-0 flex-1">
                <p className="text-xs text-neutral-400">
                  {problem.course} · {problem.unit} · {problem.lesson}
                </p>
                <p className="truncate text-sm text-neutral-800">{problem.question}</p>
              </div>
              <span
                className={
                  problem.versions
                    ? "shrink-0 rounded-full bg-green-100 px-2 py-0.5 text-xs font-bold text-green-700"
                    : "shrink-0 rounded-full bg-slate-100 px-2 py-0.5 text-xs text-neutral-500"
                }
              >
                {problem.versions ? `${problem.versions} version${problem.versions === 1 ? "" : "s"}` : "no solution"}
              </span>
            </Link>
          </li>
        ))}
      </ul>
    </div>
  );
};

export default MathAuthorPage;
