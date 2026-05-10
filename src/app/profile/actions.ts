"use server";

import { revalidatePath } from "next/cache";

import { getSupabaseAdminClient } from "@/lib/supabase/server";
import { V1_USER_ID } from "@/lib/v1-user";

/**
 * Server action: persist the user's profile_md.
 *
 * v1 writes to a fixed user row (V1_USER_ID); Day 7 swaps that for an
 * auth.uid() lookup. Returns a discriminated result the client component
 * uses to render success/error toasts.
 *
 * Trims trailing whitespace and caps length defensively. The textarea
 * itself is unbounded; we don't want a single paste to balloon the row
 * past what's reasonable to feed into a Sonnet system prompt every
 * scoring run.
 */
const PROFILE_MD_MAX_LENGTH = 10_000; // 10KB — generous; ~2.5K tokens upper bound

export type UpdateProfileResult =
  | { ok: true; savedAt: string }
  | { ok: false; error: string };

export async function updateProfile(
  _previous: UpdateProfileResult | null,
  formData: FormData,
): Promise<UpdateProfileResult> {
  const raw = formData.get("profile_md");
  if (typeof raw !== "string") {
    return { ok: false, error: "Missing profile_md field" };
  }

  const trimmed = raw.trimEnd();
  if (trimmed.length > PROFILE_MD_MAX_LENGTH) {
    return {
      ok: false,
      error: `Profile is too long (${trimmed.length.toLocaleString()} / ${PROFILE_MD_MAX_LENGTH.toLocaleString()} chars). Trim it down.`,
    };
  }

  const supabase = getSupabaseAdminClient();
  const { error } = await supabase
    .from("users")
    .update({ profile_md: trimmed })
    .eq("id", V1_USER_ID);

  if (error) {
    return { ok: false, error: error.message };
  }

  // Re-render the profile page so the textarea reflects the saved value.
  revalidatePath("/profile");

  return { ok: true, savedAt: new Date().toISOString() };
}
