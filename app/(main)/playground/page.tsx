import { redirect } from "next/navigation";

import { listSnippets } from "@/actions/code-snippets";
import { Playground } from "@/components/coding/playground";
import { getCurrentUser } from "@/lib/auth";

export const metadata = { title: "Playground" };

// The code playground (docs/DESIGN-coding-and-math.md, section 4.1): the lesson editor for any
// language, with programs saved to the account.
const PlaygroundPage = async () => {
  const user = await getCurrentUser();
  if (!user) redirect("/sign-in");

  const snippets = await listSnippets();

  return (
    <div className="px-4 pb-10 lg:px-6">
      <h1 className="mb-4 text-2xl font-bold text-neutral-800">Playground</h1>
      <Playground initialSnippets={snippets} />
    </div>
  );
};

export default PlaygroundPage;
