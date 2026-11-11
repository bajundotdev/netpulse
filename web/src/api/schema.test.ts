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
  it.skipIf(!existsSync(python))(
    "schema.d.ts is up to date with the backend OpenAPI schema (run `npm run gen:api` to refresh)",
    () => {
      const dir = mkdtempSync(path.join(tmpdir(), "netpulse-schema-test-"));
      try {
        const out = path.join(dir, "schema.d.ts");
        execFileSync(process.execPath, [path.join(webDir, "scripts", "export-openapi.mjs"), out], {
          cwd: webDir,
        });
        const committed = readFileSync(path.join(webDir, "src", "api", "schema.d.ts"), "utf8");
        expect(readFileSync(out, "utf8") === committed).toBe(true);
      } finally {
        rmSync(dir, { recursive: true, force: true });
      }
    },
    60_000,
  );
});
