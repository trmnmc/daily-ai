/**
 * V1 single-user identity.
 *
 * v1 ships for the project owner only — no auth UI exists yet (that's Day 7).
 * Until Supabase Auth is wired, all server-side operations that need a user
 * context (profile reads/writes, repo storage, scoring runs) use this fixed ID.
 *
 * The corresponding `auth.users` row was seeded via the Supabase admin API on
 * 2026-05-09; the bootstrap trigger then auto-created the matching `public.users`
 * row. When auth lands on Day 7, this ID stays valid — magic-link sign-in for
 * the same email simply re-uses the existing row.
 *
 * Replace usages of this constant with `auth.uid()` (server-side) once the
 * `getCurrentUserId()` helper exists.
 */
export const V1_USER_ID = "f8a25c61-f381-4e58-ad4a-e7690474f0a1";
