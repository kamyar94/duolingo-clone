import { sql } from "drizzle-orm";
import { NextResponse } from "next/server";

import db from "@/db/drizzle";

export const dynamic = "force-dynamic";

// Used by the container health check: answers only when the database answers too.
export const GET = async () => {
  try {
    await db.execute(sql`select 1`);
    return NextResponse.json({ ok: true });
  } catch {
    return NextResponse.json({ ok: false }, { status: 503 });
  }
};
