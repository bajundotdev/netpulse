import { execFileSync } from "node:child_process";
import { existsSync, mkdtempSync, readFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { describe, expect, it } from "vitest";

const webDir = path.resolve(import.meta.dirname, "..", "..");
const python = path.resolve(
  webDir,
  "..",
  "backend",
  ".venv",
  ...(process.platform === "win32" ? ["Scripts", "python.exe"] : ["bin", "python"]),
);

describe("generated API types", () => {
  const hasPython = existsSync(python);
  it.skipIf(!hasPython)(
    hasPython
      ? "schema.d.ts is up to date with the backend OpenAPI schema (run `npm run gen:api` to refresh)"
      : `schema.d.ts is up to date (SKIPPED: backend venv python not found at ${python})`,
    () => {
      const dir = mkdtempSync(path.join(tmpdir(), "netpulse-schema-test-"));
      try {
        const out = path.join(dir, "schema.d.ts");
        try {
          execFileSync(process.execPath, [path.join(webDir, "scripts", "export-openapi.mjs"), out], {
            cwd: webDir,
            timeout: 110_000,
            stdio: ["ignore", "pipe", "pipe"],
          });
        } catch (e) {
          const stderr = String((e as { stderr?: unknown }).stderr ?? "").trim();
          const firstLine = stderr.split("\n").find((l) => l.trim()) ?? (e as Error).message;
          throw new Error(`Could not regenerate schema.d.ts: ${firstLine}`);
        }
        const committed = readFileSync(path.join(webDir, "src", "api", "schema.d.ts"), "utf8");
        expect(readFileSync(out, "utf8") === committed).toBe(true);
      } finally {
        rmSync(dir, { recursive: true, force: true });
      }
    },
    120_000,
  );
});
