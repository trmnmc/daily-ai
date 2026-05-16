import { TopNav } from "@/components/layout/top-nav";
import { OsintConsole } from "@/components/osint/osint-console";
import { OSINT_CATEGORIES } from "@/lib/osint-data";

/**
 * /osint — Live OSINT Console.
 *
 * A categorized directory of open-source intelligence resources modeled on
 * the OSINT Framework (lockfale/OSINT-Framework), restyled as a live
 * investigation surface. Three panes on desktop:
 *
 *   ┌─────────────────────────────────────────────────────────────┐
 *   │ TARGET: ▌ ___________________   session 042 · 14:22:08 UTC  │
 *   ├──────────────┬──────────────────────────────┬───────────────┤
 *   │  CATEGORIES  │  RESOURCES                   │  ACTIVITY     │
 *   │              │                              │               │
 *   │  Username 4  │  ─── Sherlock         tool   │  14:21  open  │
 *   │  Email    5  │  ─── WhatsMyName      link   │  14:18  log   │
 *   │  Domain   6  │  ─── Namechk          link   │               │
 *   │  ...         │  ...                         │               │
 *   └──────────────┴──────────────────────────────┴───────────────┘
 *
 * The server component owns nothing but the static category corpus. All
 * interactive state (selected category, target input, activity log) lives
 * in <OsintConsole>, the client child.
 *
 * No persistence in v1 — refresh resets the session. v2 would persist the
 * target + log per user in Supabase, similar to the daily-ai feed pattern.
 */
export default function OsintPage() {
  return (
    <>
      <TopNav />
      <OsintConsole categories={OSINT_CATEGORIES} />
    </>
  );
}
