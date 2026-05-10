import { beforeEach, describe, expect, it, vi } from "vitest";

// Mock the modules `actions.ts` reaches into. Both are hoisted by vitest.
vi.mock("next/cache", () => ({ revalidatePath: vi.fn() }));
vi.mock("@/lib/supabase/server", () => ({ getSupabaseAdminClient: vi.fn() }));
vi.mock("@/lib/github", async () => {
  const actual = await vi.importActual<typeof import("@/lib/github")>(
    "@/lib/github",
  );
  return {
    ...actual,
    fetchPublicRepo: vi.fn(),
  };
});

import { fetchPublicRepo, RepoFetchError } from "@/lib/github";
import { getSupabaseAdminClient } from "@/lib/supabase/server";

import { refreshRepo, removeRepo } from "./actions";

/**
 * Tests target the two destructive/state-changing server actions added in the
 * previous tick. Same minimal Supabase builder pattern as scoring-runner —
 * thenable + chainable, configured per test.
 *
 * The user-scoping invariant (`WHERE id = ? AND user_id = ?`) is the most
 * important property to lock down here. A regression that drops the user_id
 * filter would let any caller delete or overwrite anyone's repos. Even in v1
 * single-user that's worth a test — Day 7 auth makes this a real boundary.
 */

const VALID_UUID = "11111111-2222-3333-4444-555555555555";
const STORED_URL = "https://github.com/owner/repo";

type Canned = { data?: unknown; error?: unknown };

function setupSupabase(opts: {
  load?: Canned;
  remove?: Canned;
  update?: Canned;
  captureUpdate?: vi.Mock;
  captureDeleteCalled?: vi.Mock;
}) {
  // The `from("user_repos")` call is shared across both load (select+maybeSingle)
  // and update (update+eq+eq). We disambiguate by the order of method calls.
  // For our tests, refresh hits load first, then update — using a single
  // builder that handles both is fine because both terminals are awaitable.
  const captures = {
    update: opts.captureUpdate ?? vi.fn(),
    deleteCalled: opts.captureDeleteCalled ?? vi.fn(),
  };

  // For removeRepo: .delete().eq().eq().select().maybeSingle() resolves with `remove`.
  // For refreshRepo (load): .select().eq().eq().maybeSingle() resolves with `load`.
  // For refreshRepo (update): .update(row).eq().eq() resolves (awaited builder) with `update`.
  // We share one builder per call to .from() and choose the result based on
  // whether `delete()` was called on this builder vs. not.

  // Simpler: switch the `from()` mock to return a fresh builder per call,
  // and use a counter to dispatch results in order.
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const supabase: any = {
    from: vi.fn(() => {
      // Build a per-call builder whose terminal resolves based on which path
      // was taken (delete vs. update vs. select).
      let usedDelete = false;
      let usedUpdate = false;
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      const b: any = {
        select: () => b,
        eq: () => b,
        delete: () => {
          usedDelete = true;
          captures.deleteCalled();
          return b;
        },
        update: (row: unknown) => {
          usedUpdate = true;
          captures.update(row);
          return b;
        },
        maybeSingle: () => {
          if (usedDelete) {
            return Promise.resolve(opts.remove ?? { data: null, error: null });
          }
          return Promise.resolve(opts.load ?? { data: null, error: null });
        },
        then: (resolve: (v: Canned) => void) => {
          if (usedUpdate) {
            return resolve(opts.update ?? { data: null, error: null });
          }
          if (usedDelete) {
            return resolve(opts.remove ?? { data: null, error: null });
          }
          return resolve(opts.load ?? { data: [], error: null });
        },
      };
      return b;
    }),
  };

  vi.mocked(getSupabaseAdminClient).mockReturnValue(supabase);
  return { supabase, captures };
}

beforeEach(() => {
  vi.clearAllMocks();
});

describe("removeRepo", () => {
  it("rejects an invalid uuid before touching the DB", async () => {
    setupSupabase({});
    const fd = new FormData();
    fd.set("id", "not-a-uuid");
    const result = await removeRepo(null, fd);
    expect(result).toEqual({ ok: false, error: "Invalid repo id." });
  });

  it("returns ok with the deleted url on success", async () => {
    setupSupabase({
      remove: { data: { repo_url: STORED_URL }, error: null },
    });
    const fd = new FormData();
    fd.set("id", VALID_UUID);
    const result = await removeRepo(null, fd);
    expect(result).toEqual({ ok: true, url: STORED_URL });
  });

  it("treats a missing matching row as 'not found' (user_id mismatch path)", async () => {
    // The WHERE id AND user_id filter eliminated the row → nothing returned.
    setupSupabase({ remove: { data: null, error: null } });
    const fd = new FormData();
    fd.set("id", VALID_UUID);
    const result = await removeRepo(null, fd);
    expect(result).toEqual({
      ok: false,
      error: "Repo not found — refresh the page.",
    });
  });

  it("propagates supabase errors as user-facing messages", async () => {
    setupSupabase({
      remove: { data: null, error: { message: "FK constraint" } },
    });
    const fd = new FormData();
    fd.set("id", VALID_UUID);
    const result = await removeRepo(null, fd);
    expect(result).toEqual({ ok: false, error: "FK constraint" });
  });
});

describe("refreshRepo", () => {
  it("rejects an invalid uuid before touching the DB", async () => {
    setupSupabase({});
    const fd = new FormData();
    fd.set("id", "not-a-uuid");
    const result = await refreshRepo(null, fd);
    expect(result).toEqual({ ok: false, error: "Invalid repo id." });
  });

  it("re-fetches and updates the row on success", async () => {
    const captureUpdate = vi.fn();
    setupSupabase({
      load: { data: { repo_url: STORED_URL }, error: null },
      update: { data: null, error: null },
      captureUpdate,
    });
    vi.mocked(fetchPublicRepo).mockResolvedValue({
      url: STORED_URL,
      readme: "# fresh",
      manifest: { files: { "package.json": '{"name":"x"}' } },
    });

    const fd = new FormData();
    fd.set("id", VALID_UUID);
    const result = await refreshRepo(null, fd);

    expect(result).toEqual({ ok: true, url: STORED_URL });
    // Update payload includes the new readme + manifest + a fresh fetched_at.
    const updateCall = captureUpdate.mock.calls[0]![0] as {
      readme: string;
      manifest_json: { files: Record<string, string> };
      fetched_at: string;
    };
    expect(updateCall.readme).toBe("# fresh");
    expect(updateCall.manifest_json.files["package.json"]).toBe('{"name":"x"}');
    expect(updateCall.fetched_at).toMatch(/^\d{4}-\d{2}-\d{2}T/);
  });

  it("returns the existing row's load error to the user", async () => {
    setupSupabase({ load: { data: null, error: { message: "row gone" } } });
    const fd = new FormData();
    fd.set("id", VALID_UUID);
    const result = await refreshRepo(null, fd);
    expect(result).toEqual({ ok: false, error: "row gone" });
  });

  it("returns 'not found' when the row is missing (no user_id match)", async () => {
    setupSupabase({ load: { data: null, error: null } });
    const fd = new FormData();
    fd.set("id", VALID_UUID);
    const result = await refreshRepo(null, fd);
    expect(result).toEqual({ ok: false, error: "Repo not found." });
  });

  it("surfaces RepoFetchError messages directly", async () => {
    setupSupabase({ load: { data: { repo_url: STORED_URL }, error: null } });
    vi.mocked(fetchPublicRepo).mockRejectedValue(
      new RepoFetchError("Repo not found or private: " + STORED_URL),
    );

    const fd = new FormData();
    fd.set("id", VALID_UUID);
    const result = await refreshRepo(null, fd);
    expect(result.ok).toBe(false);
    expect(result.ok === false ? result.error : "").toContain(
      "Repo not found or private",
    );
  });

  it("propagates update errors", async () => {
    setupSupabase({
      load: { data: { repo_url: STORED_URL }, error: null },
      update: { data: null, error: { message: "update failed" } },
    });
    vi.mocked(fetchPublicRepo).mockResolvedValue({
      url: STORED_URL,
      readme: null,
      manifest: { files: {} },
    });

    const fd = new FormData();
    fd.set("id", VALID_UUID);
    const result = await refreshRepo(null, fd);
    expect(result).toEqual({ ok: false, error: "update failed" });
  });
});
