import { describe, expect, it, vi } from "vitest";
import type Anthropic from "@anthropic-ai/sdk";

import {
  buildStoryMessage,
  buildSystemPrompt,
  scoreStory,
  ScoringRefusalError,
  ScoringValidationError,
  type CreateMessage,
  type ScoringDeps,
  type StoryToScore,
  type UserScoringContext,
} from "./scoring";

const sampleCtx: UserScoringContext = {
  profile_md: "I build RAG tools in TypeScript.",
  repos: [
    {
      url: "https://github.com/me/rag-thing",
      readme: "# Rag Thing\nDoes RAG.",
      manifest: { files: { "package.json": '{"name":"rag-thing"}' } },
    },
  ],
};

const sampleStory: StoryToScore = {
  id: "story-1",
  title: "Sonnet 4.6 ships with native JSON mode",
  body: "Anthropic shipped a structured-outputs feature on the Messages API.",
  source_name: "hn-algolia-ai",
};

describe("buildSystemPrompt", () => {
  it("includes profile and repo content for cache stability", () => {
    const prompt = buildSystemPrompt(sampleCtx);
    expect(prompt).toContain("I build RAG tools in TypeScript.");
    expect(prompt).toContain("https://github.com/me/rag-thing");
    expect(prompt).toContain("package.json");
    expect(prompt).toContain('{"name":"rag-thing"}');
  });

  it("handles empty profile and zero repos without throwing", () => {
    const prompt = buildSystemPrompt({ profile_md: "", repos: [] });
    expect(prompt).toContain("(profile not yet written)");
    expect(prompt).toContain("(No repos pasted yet");
  });

  it("does NOT include any per-call volatility (timestamps, IDs, etc.)", () => {
    // This is a load-bearing property: any byte change here invalidates the
    // prompt cache, blowing scoring cost up ~10x. If a future contributor
    // sneaks Date.now() / uuid / current time into the system prompt, this
    // test gives them a chance to notice before it ships.
    const a = buildSystemPrompt(sampleCtx);
    const b = buildSystemPrompt(sampleCtx);
    expect(a).toBe(b);
  });
});

describe("buildStoryMessage", () => {
  it("includes source, title, and body", () => {
    const msg = buildStoryMessage(sampleStory);
    expect(msg).toContain("hn-algolia-ai");
    expect(msg).toContain("Sonnet 4.6 ships");
    expect(msg).toContain("structured-outputs");
  });

  it("falls back when body is missing", () => {
    const msg = buildStoryMessage({ ...sampleStory, body: null });
    expect(msg).toContain("(no body content available)");
  });
});

/**
 * Build a fake Anthropic.Message that contains a single text block. Mirrors
 * what the SDK returns when output_config.format is set — the JSON lives in
 * a text block, not a separate parsed_output field (that's only on .parse()).
 */
function makeMessage(args: {
  text?: string;
  stop_reason?: Anthropic.Message["stop_reason"];
}): Anthropic.Message {
  return {
    id: "msg_test",
    type: "message",
    role: "assistant",
    model: "claude-sonnet-4-6",
    content: args.text === undefined ? [] : [{ type: "text", text: args.text, citations: null }],
    stop_reason: args.stop_reason ?? "end_turn",
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
  } as Anthropic.Message;
}

function depsReturning(message: Anthropic.Message): {
  deps: ScoringDeps;
  createMessage: ReturnType<typeof vi.fn>;
} {
  const createMessage = vi.fn<CreateMessage>().mockResolvedValue(message);
  return { deps: { createMessage }, createMessage };
}

describe("scoreStory", () => {
  it("returns a validated ScoreResult on a well-formed response", async () => {
    const { deps } = depsReturning(
      makeMessage({
        text: JSON.stringify({
          score: 87,
          why_i_care: "You're shipping a RAG-on-TS pipeline; structured JSON eliminates a parse step.",
          tags: ["json-mode", "structured-outputs", "sonnet-4-6"],
        }),
      }),
    );
    const result = await scoreStory(deps, sampleCtx, sampleStory);
    expect(result).toEqual({
      score: 87,
      why_i_care:
        "You're shipping a RAG-on-TS pipeline; structured JSON eliminates a parse step.",
      tags: ["json-mode", "structured-outputs", "sonnet-4-6"],
    });
  });

  it("sends a cache_control breakpoint on the system prompt", async () => {
    // Cache discipline check: the system block MUST carry cache_control or the
    // 5-min TTL inner-loop economy collapses. This catches accidental removal.
    const { deps, createMessage } = depsReturning(
      makeMessage({ text: JSON.stringify({ score: 50, why_i_care: "x", tags: ["a"] }) }),
    );
    await scoreStory(deps, sampleCtx, sampleStory);
    const params = createMessage.mock.calls[0]![0]!;
    const system = params.system;
    if (!Array.isArray(system)) throw new Error("system was not an array");
    const sysBlock = system[0];
    if (typeof sysBlock !== "object" || sysBlock === null) {
      throw new Error("system[0] was not an object");
    }
    expect((sysBlock as { cache_control?: unknown }).cache_control).toEqual({
      type: "ephemeral",
    });
  });

  it("normalizes tags to lowercase and trims whitespace", async () => {
    const { deps } = depsReturning(
      makeMessage({
        text: JSON.stringify({
          score: 65,
          why_i_care: "Whatever.",
          tags: ["  RAG  ", "Vector-DB", "", "  "],
        }),
      }),
    );
    const result = await scoreStory(deps, sampleCtx, sampleStory);
    expect(result.tags).toEqual(["rag", "vector-db"]);
  });

  it("throws ScoringRefusalError on refusal stop_reason", async () => {
    const { deps } = depsReturning(makeMessage({ stop_reason: "refusal" }));
    await expect(scoreStory(deps, sampleCtx, sampleStory)).rejects.toBeInstanceOf(
      ScoringRefusalError,
    );
  });

  it("throws ScoringValidationError when JSON is malformed", async () => {
    const { deps } = depsReturning(makeMessage({ text: "not json {{{" }));
    await expect(scoreStory(deps, sampleCtx, sampleStory)).rejects.toBeInstanceOf(
      ScoringValidationError,
    );
  });

  it("throws ScoringValidationError when score is out of 0-100", async () => {
    const { deps } = depsReturning(
      makeMessage({
        text: JSON.stringify({ score: 150, why_i_care: "x", tags: ["a"] }),
      }),
    );
    await expect(scoreStory(deps, sampleCtx, sampleStory)).rejects.toBeInstanceOf(
      ScoringValidationError,
    );
  });

  it("throws ScoringValidationError when score is not an integer", async () => {
    const { deps } = depsReturning(
      makeMessage({
        text: JSON.stringify({ score: 87.5, why_i_care: "x", tags: ["a"] }),
      }),
    );
    await expect(scoreStory(deps, sampleCtx, sampleStory)).rejects.toBeInstanceOf(
      ScoringValidationError,
    );
  });

  it("throws ScoringValidationError when why_i_care is empty", async () => {
    const { deps } = depsReturning(
      makeMessage({
        text: JSON.stringify({ score: 50, why_i_care: "  ", tags: ["a"] }),
      }),
    );
    await expect(scoreStory(deps, sampleCtx, sampleStory)).rejects.toBeInstanceOf(
      ScoringValidationError,
    );
  });

  it("throws ScoringValidationError when tags array is empty after normalization", async () => {
    const { deps } = depsReturning(
      makeMessage({
        text: JSON.stringify({ score: 50, why_i_care: "x", tags: ["", "  "] }),
      }),
    );
    await expect(scoreStory(deps, sampleCtx, sampleStory)).rejects.toBeInstanceOf(
      ScoringValidationError,
    );
  });
});
