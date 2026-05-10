import { describe, expect, it } from "vitest";

import {
  parseAnthropicArticle,
  parseAnthropicSitemap,
  selectRecentEntries,
} from "./anthropic-blog";

const SITEMAP_FIXTURE = `<?xml version="1.0" encoding="UTF-8"?>
<urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">
  <url>
    <loc>https://www.anthropic.com/</loc>
    <lastmod>2026-05-09T07:57:30.952Z</lastmod>
  </url>
  <url>
    <loc>https://www.anthropic.com/engineering</loc>
    <lastmod>2025-01-24T13:34:54.000Z</lastmod>
  </url>
  <url>
    <loc>https://www.anthropic.com/news/claude-opus-4-7</loc>
    <lastmod>2026-05-08T15:00:00.000Z</lastmod>
  </url>
  <url>
    <loc>https://www.anthropic.com/engineering/building-effective-agents</loc>
    <lastmod>2026-04-13T17:46:47.000Z</lastmod>
  </url>
  <url>
    <loc>https://www.anthropic.com/research/tracing-thoughts-language-model</loc>
    <lastmod>2026-03-01T12:00:00.000Z</lastmod>
  </url>
  <url>
    <loc>https://www.anthropic.com/careers</loc>
    <lastmod>2026-01-15T00:23:05.000Z</lastmod>
  </url>
</urlset>`;

describe("parseAnthropicSitemap", () => {
  it("keeps only news/engineering/research post entries", () => {
    const entries = parseAnthropicSitemap(SITEMAP_FIXTURE);

    expect(entries.map((entry) => entry.url)).toEqual([
      "https://www.anthropic.com/news/claude-opus-4-7",
      "https://www.anthropic.com/engineering/building-effective-agents",
      "https://www.anthropic.com/research/tracing-thoughts-language-model",
    ]);
    expect(entries[0]?.lastmod).toBe("2026-05-08T15:00:00.000Z");
  });
});

describe("selectRecentEntries", () => {
  it("sorts by lastmod descending and applies the limit", () => {
    const entries = parseAnthropicSitemap(SITEMAP_FIXTURE);
    const recent = selectRecentEntries(entries, 2);

    expect(recent.map((entry) => entry.url)).toEqual([
      "https://www.anthropic.com/news/claude-opus-4-7",
      "https://www.anthropic.com/engineering/building-effective-agents",
    ]);
  });

  it("treats missing lastmod as the oldest", () => {
    const recent = selectRecentEntries([
      { url: "https://www.anthropic.com/news/no-date", lastmod: null },
      {
        url: "https://www.anthropic.com/news/dated",
        lastmod: "2026-04-01T00:00:00.000Z",
      },
    ]);

    expect(recent[0]?.url).toBe("https://www.anthropic.com/news/dated");
  });
});

describe("parseAnthropicArticle", () => {
  it("prefers og:title and the first post paragraph", () => {
    const story = parseAnthropicArticle(
      `<!doctype html>
        <html>
          <head>
            <title>Introducing Claude Opus 4.7 \\ Anthropic</title>
            <meta property="og:title" content="Introducing Claude Opus 4.7" />
            <meta property="og:description" content="Generally available today." />
            <meta name="description" content="Generally available today." />
          </head>
          <body>
            <h1>Introducing Claude Opus 4.7</h1>
            <p class="post-text">Our latest model, Claude Opus 4.7, is now generally available.</p>
            <p class="post-text">A second paragraph that should be ignored.</p>
          </body>
        </html>`,
      "https://www.anthropic.com/news/claude-opus-4-7",
      "2026-05-08T15:00:00.000Z",
    );

    expect(story).toEqual({
      sourceName: "anthropic-blog",
      title: "Introducing Claude Opus 4.7",
      url: "https://www.anthropic.com/news/claude-opus-4-7",
      body: "Our latest model, Claude Opus 4.7, is now generally available.",
      publishedAt: "2026-05-08T15:00:00.000Z",
    });
  });

  it("strips the ' \\ Anthropic' suffix and falls back to meta description", () => {
    const story = parseAnthropicArticle(
      `<!doctype html>
        <html>
          <head>
            <title>Building effective agents \\ Anthropic</title>
            <meta name="description" content="How Anthropic builds reliable agents." />
          </head>
          <body><article><p>Body without post-text class.</p></article></body>
        </html>`,
      "https://www.anthropic.com/engineering/building-effective-agents",
      null,
    );

    expect(story?.title).toBe("Building effective agents");
    expect(story?.body).toBe("Body without post-text class.");
  });

  it("returns null when no title can be extracted", () => {
    const story = parseAnthropicArticle(
      "<!doctype html><html><head></head><body></body></html>",
      "https://www.anthropic.com/news/empty",
      null,
    );

    expect(story).toBeNull();
  });
});
