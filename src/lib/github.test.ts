import { describe, expect, it } from "vitest";

import {
  fetchPublicRepo,
  parseGithubUrl,
  RepoFetchError,
} from "./github";

describe("parseGithubUrl", () => {
  it("accepts canonical github.com URLs", () => {
    expect(parseGithubUrl("https://github.com/anthropics/claude-cookbooks"))
      .toEqual({
        url: "https://github.com/anthropics/claude-cookbooks",
        owner: "anthropics",
        repo: "claude-cookbooks",
      });
  });

  it("strips trailing .git and trailing slash", () => {
    expect(parseGithubUrl("https://github.com/owner/repo.git/"))
      .toMatchObject({ url: "https://github.com/owner/repo", repo: "repo" });
  });

  it("accepts bare owner/repo paste", () => {
    expect(parseGithubUrl("anthropics/anthropic-sdk-python"))
      .toMatchObject({ owner: "anthropics", repo: "anthropic-sdk-python" });
  });

  it("accepts www.github.com", () => {
    expect(parseGithubUrl("https://www.github.com/owner/repo"))
      .toMatchObject({ owner: "owner", repo: "repo" });
  });

  it("rejects non-github hosts", () => {
    expect(parseGithubUrl("https://gitlab.com/owner/repo")).toBeNull();
  });

  it("rejects junk input", () => {
    expect(parseGithubUrl("")).toBeNull();
    expect(parseGithubUrl("   ")).toBeNull();
    expect(parseGithubUrl("not a url")).toBeNull();
    expect(parseGithubUrl("https://github.com/")).toBeNull();
    expect(parseGithubUrl("https://github.com/owner")).toBeNull();
  });
});

describe("fetchPublicRepo", () => {
  function mockFetch(responses: Record<string, { status: number; json?: unknown }>) {
    return async (url: string | URL | Request) => {
      const key = typeof url === "string" ? url : url.toString();
      const match = responses[key];
      if (!match) {
        return new Response(null, { status: 500 });
      }
      return new Response(
        match.json !== undefined ? JSON.stringify(match.json) : null,
        { status: match.status },
      );
    };
  }

  const parsed = {
    url: "https://github.com/owner/repo",
    owner: "owner",
    repo: "repo",
  };

  it("throws RepoFetchError on 404 from probe", async () => {
    const fetchImpl = mockFetch({
      "https://api.github.com/repos/owner/repo": { status: 404 },
    });
    await expect(fetchPublicRepo(parsed, fetchImpl as typeof fetch))
      .rejects.toBeInstanceOf(RepoFetchError);
  });

  it("returns README + present manifest files, skipping 404s", async () => {
    const b64 = (s: string) => Buffer.from(s).toString("base64");
    const fetchImpl = mockFetch({
      "https://api.github.com/repos/owner/repo": { status: 200, json: { name: "repo" } },
      "https://api.github.com/repos/owner/repo/readme": {
        status: 200,
        json: { content: b64("# Hello"), encoding: "base64" },
      },
      "https://api.github.com/repos/owner/repo/contents/package.json": {
        status: 200,
        json: { content: b64('{"name":"x"}'), encoding: "base64" },
      },
      "https://api.github.com/repos/owner/repo/contents/requirements.txt": { status: 404 },
      "https://api.github.com/repos/owner/repo/contents/pyproject.toml": { status: 404 },
    });
    const result = await fetchPublicRepo(parsed, fetchImpl as typeof fetch);
    expect(result.readme).toBe("# Hello");
    expect(result.manifest.files["package.json"]).toBe('{"name":"x"}');
    expect(result.manifest.files["requirements.txt"]).toBeUndefined();
    expect(result.manifest.files["pyproject.toml"]).toBeUndefined();
  });
});
