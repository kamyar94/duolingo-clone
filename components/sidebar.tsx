import Image from "next/image";
import Link from "next/link";

import { getCurrentUser } from "@/lib/auth";
import { cn } from "@/lib/utils";

import { SidebarItem } from "./sidebar-item";
import { SignOutButton } from "./sign-out-button";

type SidebarProps = {
  className?: string;
};

export const Sidebar = async ({ className }: SidebarProps) => {
  const user = await getCurrentUser();

  return (
    <div
      className={cn(
        "left-0 top-0 flex h-full flex-col border-r-2 px-4 lg:fixed lg:w-[256px]",
        className
      )}
    >
      <Link href="/learn" prefetch>
        <div className="flex items-center gap-x-3 pb-7 pl-4 pt-8">
          <Image src="/mascot.svg" alt="Mascot" height={40} width={40} />

          <h1 className="text-2xl font-extrabold tracking-wide text-green-600">
            Lingo
          </h1>
        </div>
      </Link>

      <div className="flex flex-1 flex-col gap-y-2">
        <SidebarItem label="Learn" href="/learn" iconSrc="/learn.svg" />
        <SidebarItem
          label="Leaderboard"
          href="/leaderboard"
          iconSrc="/leaderboard.svg"
        />
        <SidebarItem label="Quests" href="/quests" iconSrc="/quests.svg" />
        <SidebarItem label="Shop" href="/shop" iconSrc="/shop.svg" />
        {user?.isAdmin && (
          <SidebarItem label="Admin" href="/admin" iconSrc="/mascot.svg" />
        )}
      </div>

      <div className="flex items-center justify-between gap-x-2 p-4">
        <p className="truncate font-bold text-neutral-600">
          {user?.displayName}
        </p>
        <SignOutButton compact />
      </div>
    </div>
  );
};
