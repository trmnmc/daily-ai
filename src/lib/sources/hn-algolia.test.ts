import { describe, expect, it } from "vitest";

import { parseHnAlgoliaResponses } from "./hn-algolia";

describe("parseHnAlgoliaResponses", () => {
  it("dedupes by objectID and falls back to HN item URLs", () => {
    const stories = parseHnAlgoliaResponses([
      {
        hits: [
          {
            objectID: "123",
            title: "Show HN: Tiny RAG debugger",
            url: null,
            author: "tptacek",
            points: 42,
            story_text: "<p>Inspect embeddings in a local UI.</p>",
            created_at: "2026-05-08T13:00:00Z",
          },
        ],
      },
      {
        hits: [
          {
            objectID: "123",
            title: "Duplicate should not show",
            url: "https://example.com/dupe",
          },
          {
            objectID: "456",
            story_title: "Claude Code workflow notes",
            story_url: "https://example.com/claude-code",
          },
        ],
      },
    ]);

    expect(stories).toEqual([
      {
        sourceName: "hn-algolia-ai",
        title: "Show HN: Tiny RAG debugger",
        url: "https://news.ycombinator.com/item?id=123",
        body: "42 points by tptacek. Inspect embeddings in a local UI.",
        publishedAt: "2026-05-08T13:00:00Z",
      },
      {
        sourceName: "hn-algolia-ai",
        title: "Claude Code workflow notes",
        url: "https://example.com/claude-code",
        body: null,
        publishedAt: null,
      },
    ]);
  });
});
