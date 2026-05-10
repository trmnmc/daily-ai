import { describe, expect, it, vi } from "vitest";
import Anthropic from "@anthropic-ai/sdk";

import { runScoringPass } from "./scoring-runner";
import { ScoringRefusalError, type ScoringDeps } from "./scoring";

/**
 * Tests target the runner's orchestration logic — the per-story loop, budget
 * gate, error routing (refusal vs queue), and summary accounting. The actual
 * scoring call (`scoreStory`) is already covered in `scoring.test.ts`; here
 * we inject a stub `scoringDeps.createMessage` so we control the response
 * shape per test without going near the network.
 *
 * Supabase is mocked with a small builder: `from(table)` returns an object
 * whose chain methods return the same object, and which is itself thenable
 * (resolves with the canned `{ data, error }`). This matches PostgREST's
 * actual surface closely enough for these tests — the runner uses only the
 * subset of methods modeled here.
 */

type Canned = { data?: unknown; error?: unknown };

/**
 * Build a thenable, chainable stand-in for a PostgREST query builder. Every
 * filter/select/order method returns `b`; terminals (`maybeSingle`, `insert`,
 * `upsert`) and `await b` all resolve with the same canned result.
 */
function builder(result: Canned, capture?: { insert?: vi.Mock; upsert?: vi.Mock }) {
  const insertSpy = capture?.insert ?? vi.fn();
  const upsertSpy = capture?.upsert ?? vi.fn();
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const b: any = {
    select: () => b,
    eq: () => b,
    in: () => b,
    order: () => b,
    limit: () => b,
    maybeSingle: () => Promise.resolve(result),
    insert: (row: unknown) => {
      insertSpy(row);
      return Promise.resolve(result);
    },
    upsert: (row: unknown, opts?: unknown) => {
      upsertSpy(row, opts);
      return Promise.resolve(result);
    },
    then: (resolve: (v: Canned) => void) => resolve(result),
  };
  return b;
}

type TableHandlers = {
  users?: Canned;
  user_repos?: Canned;
  story_scores?: Canned;
  stories?: Canned;
  sources?: Canned;
  scoring_retry_queue?: Canned;
};

function makeMockSupabase(opts: {
  tables: TableHandlers;
  rpc?: ReturnType<typeof vi.fn>;
  inserts?: { story_scores?: ReturnType<typeof vi.fn> };
  upserts?: { scoring_retry_queue?: ReturnType<typeof vi.fn> };
}) {
  const insertSpyByTable = {
    story_scores: opts.inserts?.story_scores ?? vi.fn(),
  };
  const upsertSpyByTable = {
    scoring_retry_queue: opts.upserts?.scoring_retry_queue ?? vi.fn(),
  };

  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const supabase: any = {
    from: vi.fn((table: string) => {
      const result = opts.tables[table as keyof TableHandlers] ?? {
        data: [],
        error: null,
      };
      return builder(result, {
        insert:
          insertSpyByTable[table as keyof typeof insertSpyByTable] ?? vi.fn(),
        upsert:
          upsertSpyByTable[table as keyof typeof upsertSpyByTable] ?? vi.fn(),
      });
    }),
    rpc: opts.rpc ?? vi.fn().mockResolvedValue({ data: true, error: null }),
  };
  return { supabase, insertSpyByTable, upsertSpyByTable };
}

const USER_ID = "user-test";
const SCORE_VALID = {
  score: 75,
  why_i_care: "Relevant to your TypeScript RAG stack.",
  tags: ["rag", "typescript"],
};

function makeStoryRows(count: number) {
  return Array.from({ length: count }, (_, i) => ({
    id: `story-${i}`,
    source_id: "src-1",
    title: `Story ${i}`,
    body: `Body ${i}`,
  }));
}

function depsReturning(
  responses: Array<{ text?: string; throws?: unknown }>,
): ScoringDeps {
  const createMessage = vi.fn();
  for (const r of responses) {
    if (r.throws) {
      createMessage.mockRejectedValueOnce(r.throws);
    } else {
      createMessage.mockResolvedValueOnce({
        id: "msg",
        type: "message",
        role: "assistant",
        model: "claude-sonnet-4-6",
        content: [{ type: "text", text: r.text ?? "{}", citations: null }],
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
      });
    }
  }
  return { createMessage };
}

function depsThrowing(error: unknown): ScoringDeps {
  return { createMessage: vi.fn().mockRejectedValue(error) };
}

const baseTables: TableHandlers = {
  users: { data: { profile_md: "I build RAG in TS." }, error: null },
  user_repos: { data: [], error: null },
  story_scores: { data: [], error: null },
  sources: { data: [{ id: "src-1", name: "hn-algolia-ai" }], error: null },
};

describe("runScoringPass", () => {
  it("returns zero-work summary when there are no unscored stories", async () => {
    const { supabase } = makeMockSupabase({
      tables: { ...baseTables, stories: { data: [], error: null } },
    });
    const createMessage = vi.fn();
    const summary = await runScoringPass({
      userId: USER_ID,
      supabase,
      scoringDeps: { createMessage },
    });
    expect(summary.considered).toBe(0);
    expect(summary.scored).toBe(0);
    expect(summary.budgetExhausted).toBe(false);
    expect(createMessage).not.toHaveBeenCalled();
  });

  it("scores a story and inserts into story_scores on the happy path", async () => {
    const insertSpy = vi.fn();
    const { supabase } = makeMockSupabase({
      tables: {
        ...baseTables,
        stories: { data: makeStoryRows(1), error: null },
        story_scores: { data: [], error: null }, // both reads (empty) and the insert
      },
      inserts: { story_scores: insertSpy },
    });
    const summary = await runScoringPass({
      userId: USER_ID,
      supabase,
      scoringDeps: depsReturning([{ text: JSON.stringify(SCORE_VALID) }]),
    });
    expect(summary.considered).toBe(1);
    expect(summary.scored).toBe(1);
    expect(summary.refused).toBe(0);
    expect(summary.queued).toBe(0);
    expect(insertSpy).toHaveBeenCalledWith({
      story_id: "story-0",
      user_id: USER_ID,
      score: 75,
      why_i_care: "Relevant to your TypeScript RAG stack.",
      tags: ["rag", "typescript"],
    });
  });

  it("stops the loop when try_charge_budget returns false", async () => {
    const insertSpy = vi.fn();
    // First charge succeeds, second fails — only one story should score.
    const rpc = vi
      .fn()
      .mockResolvedValueOnce({ data: true, error: null })
      .mockResolvedValueOnce({ data: false, error: null });
    const { supabase } = makeMockSupabase({
      tables: {
        ...baseTables,
        stories: { data: makeStoryRows(3), error: null },
      },
      inserts: { story_scores: insertSpy },
      rpc,
    });
    const summary = await runScoringPass({
      userId: USER_ID,
      supabase,
      scoringDeps: depsReturning([{ text: JSON.stringify(SCORE_VALID) }]),
    });
    expect(summary.scored).toBe(1);
    expect(summary.budgetExhausted).toBe(true);
    expect(rpc).toHaveBeenCalledTimes(2); // tried second story, then stopped
    expect(insertSpy).toHaveBeenCalledTimes(1);
  });

  it("counts refusals without pushing to the retry queue", async () => {
    const upsertSpy = vi.fn();
    const insertSpy = vi.fn();
    const { supabase } = makeMockSupabase({
      tables: {
        ...baseTables,
        stories: { data: makeStoryRows(1), error: null },
      },
      inserts: { story_scores: insertSpy },
      upserts: { scoring_retry_queue: upsertSpy },
    });
    const refusal = new ScoringRefusalError("safety");
    const summary = await runScoringPass({
      userId: USER_ID,
      supabase,
      scoringDeps: depsThrowing(refusal),
    });
    expect(summary.refused).toBe(1);
    expect(summary.queued).toBe(0);
    expect(upsertSpy).not.toHaveBeenCalled();
    expect(insertSpy).not.toHaveBeenCalled();
  });

  it("pushes other errors to the retry queue and continues", async () => {
    const upsertSpy = vi.fn();
    const insertSpy = vi.fn();
    const { supabase } = makeMockSupabase({
      tables: {
        ...baseTables,
        stories: { data: makeStoryRows(2), error: null },
      },
      inserts: { story_scores: insertSpy },
      upserts: { scoring_retry_queue: upsertSpy },
    });
    // First story errors, second succeeds — verifies the loop continues past errors.
    const apiError = new Anthropic.APIError(529, undefined, "overloaded", undefined);
    const createMessage = vi
      .fn()
      .mockRejectedValueOnce(apiError)
      .mockResolvedValueOnce({
        id: "msg",
        type: "message",
        role: "assistant",
        model: "claude-sonnet-4-6",
        content: [
          { type: "text", text: JSON.stringify(SCORE_VALID), citations: null },
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
      });
    const summary = await runScoringPass({
      userId: USER_ID,
      supabase,
      scoringDeps: { createMessage },
    });
    expect(summary.queued).toBe(1);
    expect(summary.scored).toBe(1);
    expect(upsertSpy).toHaveBeenCalledTimes(1);
    expect(insertSpy).toHaveBeenCalledTimes(1);
    // Queue payload includes the failure reason.
    const upsertPayload = upsertSpy.mock.calls[0]![0] as {
      story_id: string;
      failure_reason: string;
    };
    expect(upsertPayload.story_id).toBe("story-0");
    expect(upsertPayload.failure_reason).toContain("anthropic 529");
  });

  it("excludes already-scored stories", async () => {
    // Anti-join check: two stories exist, one is already in story_scores.
    const insertSpy = vi.fn();
    const { supabase } = makeMockSupabase({
      tables: {
        ...baseTables,
        stories: { data: makeStoryRows(2), error: null },
        story_scores: { data: [{ story_id: "story-0" }], error: null },
      },
      inserts: { story_scores: insertSpy },
    });
    const summary = await runScoringPass({
      userId: USER_ID,
      supabase,
      scoringDeps: depsReturning([{ text: JSON.stringify(SCORE_VALID) }]),
    });
    expect(summary.considered).toBe(1);
    expect(summary.scored).toBe(1);
    // Only the unscored story should reach the insert.
    const insertedRow = insertSpy.mock.calls[0]![0] as { story_id: string };
    expect(insertedRow.story_id).toBe("story-1");
  });

  it("subtracts the ignore-tag penalty before persisting (Day 3 #12)", async () => {
    // User previously ignored a story tagged ["rag", "vector-db"]. Their
    // ignored-tag union therefore contains both. The new story is scored 80
    // by Sonnet with tags ["rag", "agentic-loops"]. One tag matches (rag),
    // so the penalty is 5 and the persisted score should be 75 — not 80.
    const insertSpy = vi.fn();
    const { supabase } = makeMockSupabase({
      tables: {
        ...baseTables,
        stories: { data: makeStoryRows(1), error: null },
        // First read on `story_scores` (anti-join for unscored) returns empty.
        // Second read on `story_scores` (tags-for-ignored-stories) also goes
        // through the same builder; we make it return the ignored-story tags
        // so loadIgnoredTagUnion picks up rag + vector-db.
        story_scores: {
          data: [{ tags: ["rag", "vector-db"] }],
          error: null,
        },
        // user has 1 prior ignore
        card_actions: {
          data: [{ story_id: "ignored-story-uuid" }],
          error: null,
        },
      },
      inserts: { story_scores: insertSpy },
    });
    const summary = await runScoringPass({
      userId: USER_ID,
      supabase,
      scoringDeps: depsReturning([
        {
          text: JSON.stringify({
            score: 80,
            why_i_care: "Relevant to your RAG work.",
            tags: ["rag", "agentic-loops"],
          }),
        },
      ]),
    });
    expect(summary.scored).toBe(1);
    const insertedRow = insertSpy.mock.calls[0]![0] as { score: number; tags: string[] };
    expect(insertedRow.score).toBe(75); // 80 - 5*1
    // Persisted tags are the story's actual tags, NOT the ignored-tag set.
    expect(insertedRow.tags).toEqual(["rag", "agentic-loops"]);
  });

  it("throws if the user row is missing (config error, not transient)", async () => {
    const { supabase } = makeMockSupabase({
      tables: { ...baseTables, users: { data: null, error: null } },
    });
    await expect(
      runScoringPass({
        userId: USER_ID,
        supabase,
        scoringDeps: { createMessage: vi.fn() },
      }),
    ).rejects.toThrow(/not found/);
  });
});
