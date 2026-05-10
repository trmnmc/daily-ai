import { TopNav } from "@/components/layout/top-nav";
import { getSupabaseAdminClient } from "@/lib/supabase/server";
import { V1_USER_ID } from "@/lib/v1-user";

import { ProfileEditor } from "./profile-editor";

/**
 * /profile — the profile.md editor.
 *
 * Day 3: server-renders the current profile_md from the v1 single user row,
 * passes it to the client editor (which owns the textarea, save action, and
 * toast feedback). Onboarding-gate redirect (when profile_md < 50 chars) lands
 * in Day 7 with the rest of auth.
 */
export const dynamic = "force-dynamic";

export default async function ProfilePage() {
  const supabase = getSupabaseAdminClient();
  const { data, error } = await supabase
    .from("users")
    .select("profile_md")
    .eq("id", V1_USER_ID)
    .maybeSingle();

  // Hard-fail loudly during dev if the v1 user row is missing — this means the
  // seed step in HANDOFF.md was skipped and nothing downstream will work right.
  if (error) {
    throw new Error(`Failed to load profile: ${error.message}`);
  }
  if (!data) {
    throw new Error(
      `V1 user row ${V1_USER_ID} not found. Re-seed via Supabase admin API (see HANDOFF.md).`,
    );
  }

  return (
    <>
      <TopNav />
      <main className="mx-auto w-full max-w-[720px] flex-1 px-4 py-8">
        <h1 className="mb-2 text-2xl font-medium tracking-tight">Profile</h1>
        <p className="mb-6 text-sm text-muted-foreground">
          Tell daily ai about your stack and current projects. The feed scores stories against this every morning.
        </p>
        <ProfileEditor initial={data.profile_md ?? ""} />
      </main>
    </>
  );
}
