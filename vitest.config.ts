import { defineConfig } from "vitest/config";
import { fileURLToPath } from "node:url";

/**
 * Vitest config — only here to register the `@/` path alias that the rest of
 * the codebase uses. Without this, `import x from "@/lib/y"` (and especially
 * `vi.mock("@/lib/y", …)`) fail to resolve in tests, even though Next.js
 * resolves them at runtime via tsconfig paths.
 *
 * Earlier source files were patched to use relative imports as a workaround
 * (see src/lib/scoring.ts, src/lib/github.ts, src/lib/supabase/server.ts).
 * That hack can be unwound over time now that the alias resolves in tests.
 */
export default defineConfig({
  resolve: {
    alias: {
      "@": fileURLToPath(new URL("./src", import.meta.url)),
    },
  },
});
