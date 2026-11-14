import { describe, expect, it } from "vitest";
import { pythonFailure } from "../../scripts/export-openapi.mjs";

const traceback = (last: string) =>
  [
    "Traceback (most recent call last):",
    '  File "<string>", line 1, in <module>',
    '  File "C:\\netpulse\\backend\\app\\monitoring\\checkers\\http.py", line 11, in <module>',
    "    import httpx2",
    last,
    "",
  ].join("\r\n");

describe("gen:api backend failures", () => {
  it("names the missing package and how to install the requirements on Windows", () => {
    const msg = pythonFailure(traceback("ModuleNotFoundError: No module named 'httpx2'"), "win32");
    expect(msg).toContain("'httpx2'");
    expect(msg).toContain("run.bat");
    expect(msg).toContain("backend\\.venv\\Scripts\\python -m pip install -r backend\\requirements.txt");
    expect(msg).not.toContain("Traceback");
  });

  it("uses POSIX paths elsewhere", () => {
    const msg = pythonFailure(traceback("ModuleNotFoundError: No module named 'truststore'"), "darwin");
    expect(msg).toContain("backend/.venv/bin/python -m pip install -r backend/requirements.txt");
  });

  it("reports other errors by their last line, not as a missing package", () => {
    expect(pythonFailure(traceback("ModuleNotFoundError: No module named 'app.nope'"), "win32")).toBe(
      "the backend could not export its API schema: ModuleNotFoundError: No module named 'app.nope'",
    );
    expect(pythonFailure(traceback("SyntaxError: invalid syntax"), "win32")).toBe(
      "the backend could not export its API schema: SyntaxError: invalid syntax",
    );
    expect(pythonFailure("", "win32")).toBe("the backend could not export its API schema: no error output");
  });
});
