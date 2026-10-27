import { LogOut } from "lucide-react";

import { signOut } from "@/actions/auth";
import { Button } from "@/components/ui/button";

type SignOutButtonProps = {
  compact?: boolean;
};

export const SignOutButton = ({ compact }: SignOutButtonProps) => {
  return (
    <form action={signOut}>
      <Button
        type="submit"
        size={compact ? "icon" : "lg"}
        variant="ghost"
        aria-label="Sign out"
        title="Sign out"
      >
        <LogOut className={compact ? "h-5 w-5" : "mr-2 h-5 w-5"} />
        {!compact && "Sign out"}
      </Button>
    </form>
  );
};
