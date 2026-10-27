import { and, eq, gt, isNull } from "drizzle-orm";

import db from "@/db/drizzle";
import { invites, users } from "@/db/schema";
import { normalizeCode, sha256 } from "@/lib/auth";

import { SignUpForm } from "./sign-up-form";

type SignUpPageProps = {
  searchParams: Promise<{ code?: string }>;
};

// Finds the account a valid, unused reset code belongs to (none for a normal invite code).
const findResetUsername = async (code: string) => {
  if (!code) return undefined;

  const invite = await db.query.invites.findFirst({
    where: and(
      eq(invites.codeHash, sha256(normalizeCode(code))),
      isNull(invites.usedAt),
      gt(invites.expiresAt, new Date())
    ),
  });

  if (!invite?.resetUserId) return undefined;

  const user = await db.query.users.findFirst({
    where: eq(users.id, invite.resetUserId),
  });

  return user?.username;
};

const SignUpPage = async ({ searchParams }: SignUpPageProps) => {
  const code = String((await searchParams).code ?? "").slice(0, 64);
  const resetUsername = await findResetUsername(code);

  return (
    <div className="flex w-full max-w-[360px] flex-col items-center gap-y-6 p-4">
      <h1 className="text-2xl font-bold text-neutral-700">
        {resetUsername ? "New password" : "Join with an invite"}
      </h1>
      <SignUpForm code={code} resetUsername={resetUsername} />
    </div>
  );
};

export default SignUpPage;
