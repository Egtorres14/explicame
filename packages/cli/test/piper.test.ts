import { createHash } from "node:crypto";
import { existsSync, readdirSync } from "node:fs";
import { mkdir, mkdtemp, readFile, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, expect, it, vi } from "vitest";
import { findFfmpeg } from "../src/ffmpeg.js";
import { download, ensurePiperEngine, createPiperProvider, piperAsset, piperVoiceUrls, PIPER_VOICES, type PiperRunner } from "../src/voice/piper.js";
import { VoiceError } from "../src/voice/provider.js";

const sha = (data: Uint8Array) => createHash("sha256").update(data).digest("hex");
const respond = (data: Uint8Array | string) => vi.fn(async () => new Response(typeof data === "string" ? data : new Uint8Array(data)));

/** One second of silent 16-bit mono WAV, like Piper writes. */
function wav(): Buffer {
  const data = Buffer.alloc(16000 * 2);
  const h = Buffer.alloc(44);
  h.write("RIFF", 0);
  h.writeUInt32LE(36 + data.length, 4);
  h.write("WAVE", 8);
  h.write("fmt ", 12);
  h.writeUInt32LE(16, 16);
  h.writeUInt16LE(1, 20);
  h.writeUInt16LE(1, 22);
  h.writeUInt32LE(16000, 24);
  h.writeUInt32LE(32000, 28);
  h.writeUInt16LE(2, 32);
  h.writeUInt16LE(16, 34);
  h.write("data", 36);
  h.writeUInt32LE(data.length, 40);
  return Buffer.concat([h, data]);
}

describe("piper downloads", () => {
  it("picks the checked build for Windows and Linux and sends macOS to the command provider", () => {
    expect(piperAsset("win32", "x64")).toEqual({ file: "piper_windows_amd64.zip", sha256: "f3c58906402b24f3a96d92145f58acba6d86c9b5db896d207f78dc80811efcea", exe: "piper.exe" });
    expect(piperAsset("linux", "x64").file).toBe("piper_linux_x86_64.tar.gz");
    expect(piperAsset("linux", "arm64").file).toBe("piper_linux_aarch64.tar.gz");
    expect(() => piperAsset("darwin", "arm64")).toThrow(/command/);
  });

  it("finds catalog voices at the pinned revision and knows the checked ones", () => {
    expect(PIPER_VOICES).toEqual({ es: "es_ES-carlfm-x_low", en: "en_US-ljspeech-medium" });
    const ald = piperVoiceUrls("es_MX-ald-medium");
    expect(ald.onnx).toBe("https://huggingface.co/rhasspy/piper-voices/resolve/c10ece1aade47bb51c153c893d14e5bf8e5b7117/es/es_MX/ald/medium/es_MX-ald-medium.onnx");
    expect(ald.json).toBe(`${ald.onnx}.json`);
    expect(ald.sha256).toBe("019b3803293c93e34a206dd2e53a3889209a514e786fd7144f7b70196c579b63");
    expect(piperVoiceUrls("pt_BR-faber-medium").sha256).toBeUndefined();
    expect(() => piperVoiceUrls("../../evil")).toThrow(VoiceError);
  });

  it("keeps a download only when its SHA-256 matches", async () => {
    const dir = await mkdtemp(join(tmpdir(), "explicame-dl-"));
    const bytes = new Uint8Array([1, 2, 3, 4]);
    await download("https://x/ok.bin", join(dir, "ok.bin"), { sha256: sha(bytes), fetchImpl: respond(bytes) as unknown as typeof fetch });
    expect([...(await readFile(join(dir, "ok.bin")))]).toEqual([1, 2, 3, 4]);
    await expect(download("https://x/bad.bin", join(dir, "bad.bin"), { sha256: "0".repeat(64), fetchImpl: respond(bytes) as unknown as typeof fetch })).rejects.toThrow(/SHA-256/);
    expect(readdirSync(dir)).toEqual(["ok.bin"]);
  });

  it("installs the engine once, without the Arabic-only model", async () => {
    const home = await mkdtemp(join(tmpdir(), "explicame-piper-home-"));
    const archive = new Uint8Array([9, 9, 9]);
    const fetchImpl = respond(archive);
    const extract = vi.fn(async (_archive: string, dir: string) => {
      await mkdir(join(dir, "piper", "espeak-ng-data"), { recursive: true });
      await writeFile(join(dir, "piper", "piper.exe"), "stub");
      await writeFile(join(dir, "piper", "libtashkeel_model.ort"), "arabic");
    });
    const asset = { file: "piper_test.zip", sha256: sha(archive), exe: "piper.exe" };
    const first = await ensurePiperEngine({ home, asset, fetchImpl: fetchImpl as unknown as typeof fetch, extract });
    expect(first.exe).toBe(join(home, "piper", "2023.11.14-2", "piper", "piper.exe"));
    expect(existsSync(join(first.dir, "libtashkeel_model.ort"))).toBe(false);
    expect(fetchImpl.mock.calls[0]![0]).toBe("https://github.com/rhasspy/piper/releases/download/2023.11.14-2/piper_test.zip");
    await ensurePiperEngine({ home, asset, fetchImpl: fetchImpl as unknown as typeof fetch, extract });
    expect(fetchImpl).toHaveBeenCalledTimes(1);
  });
});

describe("piper provider", () => {
  async function provider(run: PiperRunner) {
    const home = await mkdtemp(join(tmpdir(), "explicame-piper-run-"));
    const archive = new Uint8Array([7]);
    const fetchImpl = vi.fn(async (url: string) => new Response(url.endsWith(".zip") ? archive : "{}"));
    return createPiperProvider({
      home,
      voices: { es: "es_ES-prueba-medium" },
      ffmpeg: () => findFfmpeg("es"),
      fetchImpl: fetchImpl as unknown as typeof fetch,
      asset: { file: "piper_test.zip", sha256: sha(archive), exe: "piper.exe" },
      extract: async (_archive, dir) => {
        await mkdir(join(dir, "piper"), { recursive: true });
        await writeFile(join(dir, "piper", "piper.exe"), "stub");
      },
      run,
    });
  }

  it("runs Piper from its own folder with relative arguments and returns MP3", async () => {
    let seen: { args: string[]; cwd: string; input: string } | undefined;
    const p = await provider(async (_exe, args, o) => {
      seen = { args, cwd: o.cwd, input: o.input };
      await writeFile(join(o.cwd, args[args.indexOf("--output_file") + 1]!), wav());
    });
    expect(p.voiceFor?.("es")).toBe("es_ES-prueba-medium");
    expect(p.voiceFor?.("en")).toBe("en_US-ljspeech-medium");
    const audio = await p.synthesize({ text: "Hola, José", lang: "es", voice: "es_ES-prueba-medium", speed: 1.25 });
    expect(audio.subarray(0, 3).toString("latin1") === "ID3" || audio[0] === 0xff).toBe(true);
    expect(seen!.input).toBe("Hola, José");
    expect(seen!.args.slice(0, 4)).toEqual(["--model", "voices/es_ES-prueba-medium.onnx", "--config", "voices/es_ES-prueba-medium.onnx.json"]);
    expect(seen!.args).toEqual(expect.arrayContaining(["--length_scale", "0.8", "--espeak_data", "espeak-ng-data"]));
    expect(seen!.args[seen!.args.indexOf("--output_file") + 1]).toMatch(/^out-[0-9a-f]+\.wav$/);
    expect(readdirSync(seen!.cwd).filter((file) => file.startsWith("out-"))).toEqual([]);
  });

  it("explains the missing Visual C++ runtime on Windows", async () => {
    const p = await provider(async () => {
      throw Object.assign(new Error("exit"), { code: 3221225781 });
    });
    await expect(p.synthesize({ text: "Hola", lang: "es", speed: 1 })).rejects.toThrow(/vc_redist\.x64\.exe/);
  });
});
