import Anthropic from "@anthropic-ai/sdk";
import { execFileSync } from "node:child_process";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";
import { AppUnreachableError } from "../src/browser/session.js";
import { exitCodeFor } from "../src/cli.js";
import { ConfigError } from "../src/config.js";
import { LoopError } from "../src/generate/loop.js";
import { VerifyError } from "../src/verify.js";
import { VoiceError } from "../src/voice/provider.js";

const ROOT = fileURLToPath(new URL("../../../", import.meta.url));

describe("exitCodeFor", () => {
  it("maps each failure to its documented exit code", () => {
    expect(exitCodeFor(new VerifyError({ index: 0, error: "x" }))).toBe(1);
    expect(exitCodeFor(new LoopError("x"))).toBe(1);
    expect(exitCodeFor(new ConfigError("x"))).toBe(2);
    expect(exitCodeFor(new AppUnreachableError("http://localhost:5173"))).toBe(3);
    expect(exitCodeFor(new VoiceError("x"))).toBe(4);
    expect(exitCodeFor(new Anthropic.APIConnectionError({ message: "offline" }))).toBe(4);
    expect(exitCodeFor(new Error("x"))).toBe(1);
  });
});

describe("binary", () => {
  it("builds and answers --help under both names", () => {
    const help = execFileSync(process.execPath, [`${ROOT}packages/cli/dist/bin.js`, "--help"], { encoding: "utf8" });
    expect(help).toContain("build");
    expect(help).toContain("verify");
    expect(help).toContain("voice");
    expect(help).toContain("login");
    expect(help).toContain("record");
    expect(help).toContain("mcp");
    const buildHelp = execFileSync(process.execPath, [`${ROOT}packages/cli/dist/bin.js`, "build", "--help"], { encoding: "utf8" });
    expect(buildHelp).toContain("--from-guide");
    expect(buildHelp).toContain("--video");
    const pkg = JSON.parse(readFileSync(`${ROOT}packages/cli/package.json`, "utf8")) as { bin: Record<string, string> };
    expect(pkg.bin).toEqual({ explicame: "dist/bin.js", "explain-me": "dist/bin.js" });
  }, 120_000);
});
