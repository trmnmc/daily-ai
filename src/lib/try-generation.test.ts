import { describe, expect, it, vi } from "vitest";
import type Anthropic from "@anthropic-ai/sdk";

import {
  buildStoryMessage,
  buildSystemPrompt,
  generateTry,
  TryRefusalError,
  TryValidationError,
  type CreateMessage,
  type StoryForTry,
  type TryDeps,
  type UserTryContext,
} from "./try-generation";

const sampleCtx: UserTryContext = {
  profile_md: "I build TypeScript RAG apps with Anthropic + pgvector.",
  repos: [
    {
      url: "https://github.com/me/rag-thing",
      readme: "# Rag Thing",
      manifest: { files: { "package.json": '{"name":"rag-thing"}' } },
    },
  ],
};

const sampleStory: StoryForTry = {
  id: "story-1",
  title: "Anthropic ships prompt-caching long-TTL beta",
  body: "Sonnet now supports 1-hour cache TTL via cache_control: { ttl: '1h' }.",
  url: "https://example.com/story-1",
};

describe("buildSystemPrompt", () => {
  it("includes profile, repos, and the format/runrules", () => {
    const p = buildSystemPrompt(sampleCtx);
    expect(p).toContain("TypeScript RAG apps");
    expect(p).toContain("https://github.com/me/rag-thing");
    expect(p).toContain('"python"');
    expect(p).toContain('"html"');
    expect(p).toContain("under 5 minutes");
  });

  it("is stable across calls (cache discipline)", () => {
    expect(buildSystemPrompt(sampleCtx)).toBe(buildSystemPrompt(sampleCtx));
  });

  it("handles empty profile + zero repos without throwing", () => {
    const p = buildSystemPrompt({ profile_md: "", repos: [] });
    expect(p).toContain("(profile not yet written)");
    expect(p).toContain("(No repos pasted yet");
  });
});

describe("buildStoryMessage", () => {
  it("includes URL, title, body", () => {
    const msg = buildStoryMessage(sampleStory);
    expect(msg).toContain("example.com/story-1");
    expect(msg).toContain("prompt-caching");
    expect(msg).toContain("1-hour cache TTL");
  });
});

function makeMessage(args: {
  text?: string;
  stop_reason?: Anthropic.Message["stop_reason"];
}): Anthropic.Message {
  return {
    id: "msg",
    type: "message",
    role: "assistant",
    model: "claude-sonnet-4-6",
    content:
      args.text === undefined
        ? []
        : [{ type: "text", text: args.text, citations: null }],
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
  deps: TryDeps;
  createMessage: ReturnType<typeof vi.fn>;
} {
  const createMessage = vi.fn<CreateMessage>().mockResolvedValue(message);
  return { deps: { createMessage }, createMessage };
}

describe("generateTry", () => {
  it("returns a validated python artifact on a well-formed response", async () => {
    const { deps } = depsReturning(
      makeMessage({
        text: JSON.stringify({
          language: "python",
          filename: "try_prompt_caching.py",
          content: "print('hello, cache')\n",
          run_command: "uv run try_prompt_caching.py",
        }),
      }),
    );
    const artifact = await generateTry(deps, sampleCtx, sampleStory);
    expect(artifact).toEqual({
      language: "python",
      filename: "try_prompt_caching.py",
      content: "print('hello, cache')\n",
      run_command: "uv run try_prompt_caching.py",
    });
  });

  it("returns a validated html artifact", async () => {
    const { deps } = depsReturning(
      makeMessage({
        text: JSON.stringify({
          language: "html",
          filename: "try_anchor_positioning.html",
          content: "<!doctype html><h1>hi</h1>",
          run_command: "open try_anchor_positioning.html",
        }),
      }),
    );
    const artifact = await generateTry(deps, sampleCtx, sampleStory);
    expect(artifact.language).toBe("html");
    expect(artifact.filename.endsWith(".html")).toBe(true);
  });

  it("sends a cache_control breakpoint on the system prompt", async () => {
    const { deps, createMessage } = depsReturning(
      makeMessage({
        text: JSON.stringify({
          language: "python",
          filename: "x.py",
          content: "x",
          run_command: "python3 x.py",
        }),
      }),
    );
    await generateTry(deps, sampleCtx, sampleStory);
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

  it("throws TryRefusalError on refusal stop_reason", async () => {
    const { deps } = depsReturning(makeMessage({ stop_reason: "refusal" }));
    await expect(generateTry(deps, sampleCtx, sampleStory)).rejects.toBeInstanceOf(
      TryRefusalError,
    );
  });

  it("rejects when language is invalid", async () => {
    const { deps } = depsReturning(
      makeMessage({
        text: JSON.stringify({
          language: "rust",
          filename: "x.rs",
          content: "fn main() {}",
          run_command: "cargo run",
        }),
      }),
    );
    await expect(generateTry(deps, sampleCtx, sampleStory)).rejects.toBeInstanceOf(
      TryValidationError,
    );
  });

  it("rejects when filename extension doesn't match language", async () => {
    // language=python but filename=demo.html — easy regression to make.
    const { deps } = depsReturning(
      makeMessage({
        text: JSON.stringify({
          language: "python",
          filename: "demo.html",
          content: "<h1>x</h1>",
          run_command: "open demo.html",
        }),
      }),
    );
    await expect(generateTry(deps, sampleCtx, sampleStory)).rejects.toBeInstanceOf(
      TryValidationError,
    );
  });

  it("rejects when filename has unsafe characters (path traversal guard)", async () => {
    const { deps } = depsReturning(
      makeMessage({
        text: JSON.stringify({
          language: "python",
          filename: "../../etc/passwd.py",
          content: "x",
          run_command: "python3 x.py",
        }),
      }),
    );
    await expect(generateTry(deps, sampleCtx, sampleStory)).rejects.toBeInstanceOf(
      TryValidationError,
    );
  });

  it("rejects when content is empty", async () => {
    const { deps } = depsReturning(
      makeMessage({
        text: JSON.stringify({
          language: "python",
          filename: "x.py",
          content: "  ",
          run_command: "python3 x.py",
        }),
      }),
    );
    await expect(generateTry(deps, sampleCtx, sampleStory)).rejects.toBeInstanceOf(
      TryValidationError,
    );
  });

  it("rejects when content exceeds the 50KB cap", async () => {
    const { deps } = depsReturning(
      makeMessage({
        text: JSON.stringify({
          language: "python",
          filename: "x.py",
          content: "x".repeat(50_001),
          run_command: "python3 x.py",
        }),
      }),
    );
    await expect(generateTry(deps, sampleCtx, sampleStory)).rejects.toBeInstanceOf(
      TryValidationError,
    );
  });

  it("rejects when run_command is empty", async () => {
    const { deps } = depsReturning(
      makeMessage({
        text: JSON.stringify({
          language: "python",
          filename: "x.py",
          content: "print(1)",
          run_command: "  ",
        }),
      }),
    );
    await expect(generateTry(deps, sampleCtx, sampleStory)).rejects.toBeInstanceOf(
      TryValidationError,
    );
  });

  it("rejects when JSON is malformed", async () => {
    const { deps } = depsReturning(makeMessage({ text: "not json {{{" }));
    await expect(generateTry(deps, sampleCtx, sampleStory)).rejects.toBeInstanceOf(
      TryValidationError,
    );
  });
});
