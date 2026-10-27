"use client";

import { useActionState } from "react";

import Link from "next/link";

import { signIn, type AuthState } from "@/actions/auth";
import { Button } from "@/components/ui/button";

import { AuthField } from "../auth-field";

export const SignInForm = () => {
  const [state, action, pending] = useActionState<AuthState, FormData>(
    signIn,
    {}
  );

  return (
    <form action={action} className="flex w-full flex-col gap-y-4">
      <AuthField
        label="Username"
        name="username"
        autoComplete="username"
        autoCapitalize="none"
        defaultValue={state.values?.username}
        required
      />
      <AuthField
        label="Password"
        name="password"
        type="password"
        autoComplete="current-password"
        required
      />

      {state.error && (
        <p className="text-sm font-bold text-rose-500" role="alert">
          {state.error}
        </p>
      )}

      <Button
        type="submit"
        size="lg"
        variant="secondary"
        className="w-full"
        disabled={pending}
      >
        Sign in
      </Button>

      <Link
        href="/sign-up"
        className="text-center text-sm font-bold text-sky-500"
      >
        I have an invite or reset code
      </Link>
    </form>
  );
};
