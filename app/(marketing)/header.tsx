import Image from "next/image";
import Link from "next/link";

import { SignOutButton } from "@/components/sign-out-button";
import { Button } from "@/components/ui/button";
import { getCurrentUser } from "@/lib/auth";

export const Header = async () => {
  const user = await getCurrentUser();

  return (
    <header className="h-20 w-full border-b-2 border-slate-200 px-4">
      <div className="mx-auto flex h-full items-center justify-between lg:max-w-screen-lg">
        <Link
          href="/"
          prefetch
          className="flex items-center gap-x-3 pb-7 pl-4 pt-8"
        >
          <Image src="/mascot.svg" alt="Mascot" height={40} width={40} />

          <h1 className="text-2xl font-extrabold tracking-wide text-green-600">
            Lingo
          </h1>
        </Link>

        <div className="flex gap-x-3">
          {user ? (
            <SignOutButton />
          ) : (
            <Button size="lg" variant="ghost" asChild>
              <Link href="/sign-in">Login</Link>
            </Button>
          )}
        </div>
      </div>
    </header>
  );
};
