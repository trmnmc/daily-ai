import { beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("next/cache", () => ({ revalidatePath: vi.fn() }));
vi.mock("@/lib/supabase/server", () => ({ getSupabaseAdminClient: vi.fn() }));

import { getSupabaseAdminClient } from "@/lib/supabase/server";
import {
  TryRefusalError,
  type TryArtifact,
  type TryDeps,
} from "@/lib/try-generation";

import { generateTryForStory, ignoreStory } from "./actions";

/**
 * Tests for the Try server-action wrapper. The constituent pieces are tested
 * elsewhere — `generateTry` itself in `try-generation.test.ts`, the user-context
 * loader logic in `scoring-runner.test.ts` (where it lives in production —
 * `actions.ts` duplicates it for the time being). What this file locks down
 * is the orchestration: input validation, story lookup, error routing for
 * refusals vs unexpected failures, and the persist-failure path.
 */

const VALID_UUID = "11111111-2222-3333-4444-555555555555";
const STORY_ROW = {
  id: VALID_UUID,
  title: "A story",
  body: "Body text.",
  url: "https://example.com/x",
};

const PROFILE_ROW = { profile_md: "I build TS RAG." };

const SAMPLE_ARTIFACT: TryArtifact = {
  language: "python",
  filename: "try_x.py",
  content: "print('hi')",
  run_command: "python3 try_x.py",
};

type Canned = { data?: unknown; error?: unknown };

/**
 * Per-call builder dispatched by the order of method invocations on the
 * specific from() chain. The action calls in this order:
 *   1. from("stories").select(...).eq(...).maybeSingle()       → STORY
 *   2. from("users").select(...).eq(...).maybeSingle()         → USER
 *   3. from("user_repos").select(...).eq(...)                   → REPOS
 *   4. from("artifacts").insert(...).select(...).single()       → INSERTED
 */
function setupSupabase(opts: {
  story?: Canned;
  user?: Canned;
  repos?: Canned;
  inserted?: Canned;
  charge?: Canned;
  captureInsert?: ReturnType<typeof vi.fn>;
}) {
  const captureInsert = opts.captureInsert ?? vi.fn();
  const rpc = vi.fn().mockResolvedValue(
    opts.charge ?? { data: true, error: null },
  );

  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const supabase: any = {
    rpc,
    from: vi.fn((table: string) => {
      let usedInsert = false;
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      const b: any = {
        select: () => b,
        eq: () => b,
        insert: (row: unknown) => {
          usedInsert = true;
          captureInsert(row);
          return b;
        },
        single: () => Promise.resolve(opts.inserted ?? { data: null, error: null }),
        maybeSingle: () => {
          if (table === "stories") return Promise.resolve(opts.story ?? { data: null, error: null });
          if (table === "users") return Promise.resolve(opts.user ?? { data: null, error: null });
          return Promise.resolve({ data: null, error: null });
        },
        then: (resolve: (v: Canned) => void) => {
          if (usedInsert) {
            return resolve(opts.inserted ?? { data: null, error: null });
          }
          if (table === "user_repos") {
            return resolve(opts.repos ?? { data: [], error: null });
          }
          return resolve({ data: [], error: null });
        },
      };
      return b;
    }),
  };

  vi.mocked(getSupabaseAdminClient).mockReturnValue(supabase);
  return { supabase, captureInsert, rpc };
}

function depsReturning(artifact: TryArtifact): TryDeps {
  return {
    createMessage: vi.fn().mockResolvedValue({
      id: "msg",
      type: "message",
      role: "assistant",
      model: "claude-sonnet-4-6",
      content: [
        { type: "text", text: JSON.stringify(artifact), citations: null },
      ],
      stop_reason: "end_turn",
      stop_sequence: null,
      usage: {
        input_tokens: 0,
        output_tokens: 0,
        cache_creation_input_tokens: null,
        cache_read_input_tokens: null,
        cache_creation: null,
        server_tool_use: null,
        service_tier: null,
      },
    }),
  };
}

function depsThrowing(error: unknown): TryDeps {
  return { createMessage: vi.fn().mockRejectedValue(error) };
}

beforeEach(() => {
  vi.clearAllMocks();
});

describe("generateTryForStory", () => {
  it("rejects an invalid story id without touching the DB or Anthropic", async () => {
    const { supabase } = setupSupabase({});
    const tryDeps: TryDeps = { createMessage: vi.fn() };
    const result = await generateTryForStory("not-a-uuid", { tryDeps });
    expect(result).toEqual({ ok: false, error: "Invalid story id." });
    expect(supabase.from).not.toHaveBeenCalled();
    expect(tryDeps.createMessage).not.toHaveBeenCalled();
  });

  it("returns 'Story not found' when the lookup yields nothing", async () => {
    setupSupabase({ story: { data: null, error: null } });
    const result = await generateTryForStory(VALID_UUID, {
      tryDeps: depsReturning(SAMPLE_ARTIFACT),
    });
    expect(result).toEqual({ ok: false, error: "Story not found." });
  });

  it("returns the artifact + id on the happy path and persists with type=try", async () => {
    const captureInsert = vi.fn();
    setupSupabase({
      story: { data: STORY_ROW, error: null },
      user: { data: PROFILE_ROW, error: null },
      repos: { data: [], error: null },
      inserted: { data: { id: "artifact-uuid" }, error: null },
      captureInsert,
    });
    const result = await generateTryForStory(VALID_UUID, {
      tryDeps: depsReturning(SAMPLE_ARTIFACT),
    });
    expect(result).toEqual({
      ok: true,
      artifact: SAMPLE_ARTIFACT,
      artifactId: "artifact-uuid",
    });
    const insertedRow = captureInsert.mock.calls[0]![0] as {
      story_id: string;
      type: string;
      content: string;
      run_command: string;
    };
    expect(insertedRow.story_id).toBe(VALID_UUID);
    expect(insertedRow.type).toBe("try");
    expect(insertedRow.content).toBe(SAMPLE_ARTIFACT.content);
    expect(insertedRow.run_command).toBe(SAMPLE_ARTIFACT.run_command);
  });

  it("returns a friendly error on TryRefusalError", async () => {
    setupSupabase({
      story: { data: STORY_ROW, error: null },
      user: { data: PROFILE_ROW, error: null },
      repos: { data: [], error: null },
    });
    const result = await generateTryForStory(VALID_UUID, {
      tryDeps: depsThrowing(new TryRefusalError("safety")),
    });
    expect(result.ok).toBe(false);
    expect(result.ok === false ? result.error : "").toContain("refused");
  });

  it("returns 'budget exhausted' when try_charge_budget says false", async () => {
    setupSupabase({
      story: { data: STORY_ROW, error: null },
      charge: { data: false, error: null },
    });
    const tryDeps = depsReturning(SAMPLE_ARTIFACT);
    const result = await generateTryForStory(VALID_UUID, { tryDeps });
    expect(result.ok).toBe(false);
    expect(result.ok === false ? result.error : "").toContain(
      "budget exhausted",
    );
    // Critical: the LLM must NOT be called when budget is exhausted.
    expect(tryDeps.createMessage).not.toHaveBeenCalled();
  });

  it("charges the budget exactly once on the happy path", async () => {
    const { rpc } = setupSupabase({
      story: { data: STORY_ROW, error: null },
      user: { data: PROFILE_ROW, error: null },
      repos: { data: [], error: null },
      inserted: { data: { id: "artifact-uuid" }, error: null },
    });
    await generateTryForStory(VALID_UUID, {
      tryDeps: depsReturning(SAMPLE_ARTIFACT),
    });
    expect(rpc).toHaveBeenCalledTimes(1);
    expect(rpc).toHaveBeenCalledWith("try_charge_budget", { p_amount: 0.1 });
  });

  it("returns 'generated but couldn't save' when the insert errors", async () => {
    setupSupabase({
      story: { data: STORY_ROW, error: null },
      user: { data: PROFILE_ROW, error: null },
      repos: { data: [], error: null },
      inserted: { data: null, error: { message: "constraint failed" } },
    });
    const result = await generateTryForStory(VALID_UUID, {
      tryDeps: depsReturning(SAMPLE_ARTIFACT),
    });
    expect(result.ok).toBe(false);
    expect(result.ok === false ? result.error : "").toContain(
      "Generated but couldn't save",
    );
  });
});

describe("ignoreStory", () => {
  it("rejects an invalid story id without touching the DB", async () => {
    const { supabase } = setupSupabase({});
    const result = await ignoreStory("not-a-uuid");
    expect(result).toEqual({ ok: false, error: "Invalid story id." });
    expect(supabase.from).not.toHaveBeenCalled();
  });

  it("inserts a card_actions row with action='ignore' on success", async () => {
    const captureInsert = vi.fn();
    setupSupabase({
      inserted: { data: null, error: null },
      captureInsert,
    });
    const result = await ignoreStory(VALID_UUID);
    expect(result).toEqual({ ok: true });
    const row = captureInsert.mock.calls[0]![0] as {
      story_id: string;
      action: string;
    };
    expect(row.story_id).toBe(VALID_UUID);
    expect(row.action).toBe("ignore");
  });

  it("propagates supabase errors as user-facing messages", async () => {
    setupSupabase({
      inserted: { data: null, error: { message: "FK violation" } },
    });
    const result = await ignoreStory(VALID_UUID);
    expect(result).toEqual({ ok: false, error: "FK violation" });
  });
});
