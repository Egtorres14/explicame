import { execFile } from "node:child_process";
import { mkdir, mkdtemp, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { promisify } from "node:util";
import { beforeAll, describe, expect, it } from "vitest";
import { ConfigError } from "../src/config.js";
import { fitDiff, getChangeContext } from "../src/diff.js";

const run = promisify(execFile);
const git = (cwd: string, ...args: string[]) => run("git", ["-c", "user.name=t", "-c", "user.email=t@example.com", ...args], { cwd });

let repo: string;
beforeAll(async () => {
  repo = await mkdtemp(join(tmpdir(), "explicame-git-"));
  await git(repo, "init", "-b", "main");
  await mkdir(join(repo, "src"));
  await writeFile(join(repo, "README.md"), "# demo\n");
  await writeFile(join(repo, "src/server.ts"), "export const port = 3000;\n");
  await git(repo, "add", ".");
  await git(repo, "commit", "-m", "base");
  await git(repo, "checkout", "-b", "feature");
  await writeFile(join(repo, "src/Filter.tsx"), "export function Filter() { return null; }\n");
  await writeFile(join(repo, "src/server.ts"), "export const port = 3001;\n");
  await git(repo, "add", ".");
  await git(repo, "commit", "-m", "feature");
});

describe("getChangeContext", () => {
  it("returns the diff between base and head with the head commit", async () => {
    const ctx = await getChangeContext({ cwd: repo, base: "main", head: "feature", lang: "es", description: "Filtro nuevo" });
    expect(ctx.diff).toContain("src/Filter.tsx");
    expect(ctx.diff).toContain("src/server.ts");
    expect(ctx.commit).toMatch(/^[0-9a-f]{7,}$/);
    expect(ctx).toMatchObject({ base: "main", head: "feature", description: "Filtro nuevo", omittedFiles: [] });
  });

  it("fails before doing anything else when there is nothing to explain", async () => {
    const promise = getChangeContext({ cwd: repo, base: "main", head: "main", lang: "es" });
    await expect(promise).rejects.toBeInstanceOf(ConfigError);
    await expect(getChangeContext({ cwd: repo, base: "main", head: "main", lang: "es" })).rejects.toThrow(/No hay cambios/);
  });

  it("reads a patch file and extra context files", async () => {
    await writeFile(join(repo, "x.patch"), "diff --git a/a.ts b/a.ts\n+export {}\n");
    const ctx = await getChangeContext({ cwd: repo, base: "main", head: "HEAD", diffFile: "x.patch", files: ["README.md"], lang: "en" });
    expect(ctx.diff).toBe("diff --git a/a.ts b/a.ts\n+export {}\n");
    expect(ctx).toMatchObject({ base: "patch", head: "x.patch", commit: "patch" });
    expect(ctx.files).toEqual([{ path: "README.md", content: "# demo\n" }]);
  });
});

describe("fitDiff", () => {
  it("keeps UI files first when the diff is too large and reports what it left out", () => {
    const server = `diff --git a/src/server.ts b/src/server.ts\n${"+x\n".repeat(50)}`;
    const ui = `diff --git a/src/Filter.tsx b/src/Filter.tsx\n${"+y\n".repeat(50)}`;
    const { text, omitted } = fitDiff(server + ui, ui.length + 10);
    expect(text).toContain("src/Filter.tsx");
    expect(text).not.toContain("src/server.ts");
    expect(omitted).toEqual(["src/server.ts"]);
  });
});
