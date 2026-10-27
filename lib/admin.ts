import { getCurrentUser } from "@/lib/auth";

// Admins are marked in the database (invite made with --admin, or scripts/lingo.mjs admin).
export const getIsAdmin = async () => {
  const user = await getCurrentUser();

  return !!user?.isAdmin;
};
