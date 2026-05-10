import { describe, expect, it } from "vitest";

import { parseGitHubTrendingHtml } from "./github-trending";

describe("parseGitHubTrendingHtml", () => {
  it("keeps AI-matching repos and filters unrelated trending repos", () => {
    const stories = parseGitHubTrendingHtml(`
      <article class="Box-row">
        <h2><a href="/openai/agents-sdk">openai / agents-sdk</a></h2>
        <p>A TypeScript framework for building AI agents.</p>
        <a href="/topics/llm">llm</a>
      </article>
      <article class="Box-row">
        <h2><a href="/example/css-grid">example / css-grid</a></h2>
        <p>Layout examples for static marketing pages.</p>
      </article>
      <article class="Box-row">
        <h2><a href="/vector-labs/search">vector-labs / search</a></h2>
        <p>Fast nearest-neighbor search.</p>
        <a href="/topics/embedding">embedding</a>
      </article>
    `);

    expect(stories.map((story) => story.title)).toEqual([
      "openai/agents-sdk",
      "vector-labs/search",
    ]);
    expect(stories[0]?.url).toBe("https://github.com/openai/agents-sdk");
    expect(stories[0]?.body).toContain("Topics: llm");
  });
});
