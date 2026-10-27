"use client";

import { useActionState } from "react";

import { signUp, type AuthState } from "@/actions/auth";
import { Button } from "@/components/ui/button";

import { AuthField } from "../auth-field";

type SignUpFormProps = {
  code: string;
  // Set when the code is a password-reset code for this existing account.
  resetUsername?: string;
};

export const SignUpForm = ({ code, resetUsername }: SignUpFormProps) => {
  const [state, action, pending] = useActionState<AuthState, FormData>(
    signUp,
    {}
  );

  return (
    <form action={action} className="flex w-full flex-col gap-y-4">
      <AuthField
        label="Invite or reset code"
        name="code"
        defaultValue={code}
        autoComplete="off"
        autoCapitalize="characters"
        placeholder="XXXX-XXXX-XXXX-XXXX"
        required
      />

      {resetUsername ? (
        <>
          <input
            type="hidden"
            name="username"
            value={resetUsername}
            autoComplete="username"
          />
          <p className="text-neutral-600">
            Choose a new password for <b>{resetUsername}</b>. Every other
            sign-in of this account ends.
          </p>
        </>
      ) : (
        <>
          <AuthField
            label="Your name (shown on the leaderboard)"
            name="displayName"
            autoComplete="nickname"
            maxLength={40}
            required
          />
          <AuthField
            label="Username (for signing in)"
            name="username"
            autoComplete="username"
            autoCapitalize="none"
            pattern="[a-zA-Z0-9._\-]{3,32}"
            title="3 to 32 letters, numbers, dot, dash or underscore"
            required
          />
        </>
      )}

      <AuthField
        label="Password (at least 10 characters)"
        name="password"
        type="password"
        autoComplete="new-password"
        minLength={10}
        required
      />
      <AuthField
        label="Password again"
        name="confirm"
        type="password"
        autoComplete="new-password"
        minLength={10}
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
        {resetUsername ? "Set new password" : "Create account"}
      </Button>
    </form>
  );
};
