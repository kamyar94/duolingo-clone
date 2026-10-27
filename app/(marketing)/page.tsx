import Image from "next/image";
import Link from "next/link";

import { Button } from "@/components/ui/button";
import { getCurrentUser } from "@/lib/auth";

export default async function MarketingPage() {
  const user = await getCurrentUser();

  return (
    <div className="mx-auto flex w-full max-w-[988px] flex-1 flex-col items-center justify-center gap-2 p-4 lg:flex-row">
      <div className="relative mb-8 h-[240px] w-[240px] lg:mb-0 lg:h-[424px] lg:w-[424px]">
        <Image src="/hero.svg" alt="Hero" fill />
      </div>

      <div className="flex flex-col items-center gap-y-8">
        <h1 className="max-w-[480px] text-center text-xl font-bold text-neutral-600 lg:text-3xl">
          Learn, practice and master new skills with Lingo.
        </h1>

        <div className="flex w-full max-w-[330px] flex-col items-center gap-y-3">
          {user ? (
            <Button size="lg" variant="secondary" className="w-full" asChild>
              <Link href="/learn" prefetch>
                Continue Learning
              </Link>
            </Button>
          ) : (
            <>
              <Button size="lg" variant="secondary" className="w-full" asChild>
                <Link href="/sign-up">I have an invite code</Link>
              </Button>

              <Button
                size="lg"
                variant="primaryOutline"
                className="w-full"
                asChild
              >
                <Link href="/sign-in">I already have an account</Link>
              </Button>
            </>
          )}
        </div>
      </div>
    </div>
  );
}
