import {
  AI_KEYWORDS,
  SOURCE_DEFINITIONS,
  dedupeStoryDrafts,
  htmlToText,
  normalizeWhitespace,
  type StoryDraft,
} from "./shared";

type HnAlgoliaHit = {
  objectID: string;
  title?: string | null;
  story_title?: string | null;
  url?: string | null;
  story_url?: string | null;
  author?: string | null;
  created_at?: string | null;
  story_text?: string | null;
  comment_text?: string | null;
  points?: number | null;
};

export type HnAlgoliaResponse = {
  hits: HnAlgoliaHit[];
};

function hnItemUrl(objectId: string): string {
  return `https://news.ycombinator.com/item?id=${encodeURIComponent(objectId)}`;
}

export function parseHnAlgoliaResponses(
  responses: HnAlgoliaResponse[],
): StoryDraft[] {
  const seenObjectIds = new Set<string>();
  const stories: StoryDraft[] = [];

  for (const response of responses) {
    for (const hit of response.hits) {
      if (seenObjectIds.has(hit.objectID)) continue;
      seenObjectIds.add(hit.objectID);

      const title = normalizeWhitespace(hit.title ?? hit.story_title);
      if (!title) continue;

      const url =
        normalizeWhitespace(hit.url ?? hit.story_url) || hnItemUrl(hit.objectID);
      const text = htmlToText(hit.story_text ?? hit.comment_text);
      const meta = [
        typeof hit.points === "number" ? `${hit.points} points` : "",
        hit.author ? `by ${hit.author}` : "",
      ]
        .filter(Boolean)
        .join(" ");
      const body = [meta, text].filter(Boolean).join(". ") || null;

      stories.push({
        sourceName: SOURCE_DEFINITIONS.hnAlgolia.name,
        title,
        url,
        body,
        publishedAt: hit.created_at ?? null,
      });
    }
  }

  return dedupeStoryDrafts(stories);
}

export async function fetchHnAlgoliaStories(
  fetchImpl: typeof fetch = fetch,
  keywords: readonly string[] = AI_KEYWORDS,
): Promise<StoryDraft[]> {
  const responses: HnAlgoliaResponse[] = [];

  for (const keyword of keywords) {
    const url = new URL(SOURCE_DEFINITIONS.hnAlgolia.url);
    url.searchParams.set("tags", "story");
    url.searchParams.set("query", keyword);
    url.searchParams.set("hitsPerPage", "20");

    const response = await fetchImpl(url);
    if (!response.ok) {
      throw new Error(
        `HN Algolia query "${keyword}" returned ${response.status} ${response.statusText}`,
      );
    }

    responses.push((await response.json()) as HnAlgoliaResponse);
  }

  return parseHnAlgoliaResponses(responses);
}
