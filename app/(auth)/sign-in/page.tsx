import { redirect } from "next/navigation";

import { getCurrentUser } from "@/lib/auth";

import { SignInForm } from "./sign-in-form";

const SignInPage = async () => {
  if (await getCurrentUser()) redirect("/learn");

  return (
    <div className="flex w-full max-w-[360px] flex-col items-center gap-y-6 p-4">
      <h1 className="text-2xl font-bold text-neutral-700">Sign in</h1>
      <SignInForm />
    </div>
  );
};

export default SignInPage;
