import { execFile, spawn } from "node:child_process";
import { createHash, randomBytes } from "node:crypto";
import { createWriteStream, existsSync } from "node:fs";
import { mkdir, mkdtemp, rename, rm } from "node:fs/promises";
import { once } from "node:events";
import { join } from "node:path";
import { finished } from "node:stream/promises";
import { promisify } from "node:util";
import { t, type Lang, type LocalizedText } from "@explicame/core";
import { toMp3 } from "../ffmpeg.js";
import { VoiceError, type VoiceProvider } from "./provider.js";

const run = promisify(execFile);

/** The last standalone Piper builds (MIT; espeak-ng inside is GPL-3.0 and runs as a separate program). */
export const PIPER_RELEASE = "2023.11.14-2";
const ENGINE_BASE = `https://github.com/rhasspy/piper/releases/download/${PIPER_RELEASE}`;
const VOICES_BASE = "https://huggingface.co/rhasspy/piper-voices/resolve/c10ece1aade47bb51c153c893d14e5bf8e5b7117";

export interface PiperAsset {
  file: string;
  sha256: string;
  exe: string;
}

/** The checked build for this system. The macOS builds ship without their libraries and never start. */
export function piperAsset(platform: NodeJS.Platform, arch: string): PiperAsset {
  if (platform === "win32" && arch === "x64") {
    return { file: "piper_windows_amd64.zip", sha256: "f3c58906402b24f3a96d92145f58acba6d86c9b5db896d207f78dc80811efcea", exe: "piper.exe" };
  }
  if (platform === "linux" && arch === "x64") {
    return { file: "piper_linux_x86_64.tar.gz", sha256: "a50cb45f355b7af1f6d758c1b360717877ba0a398cc8cbe6d2a7a3a26e225992", exe: "piper" };
  }
  if (platform === "linux" && arch === "arm64") {
    return { file: "piper_linux_aarch64.tar.gz", sha256: "fea0fd2d87c54dbc7078d0f878289f404bd4d6eea6e7444a77835d1537ab88eb", exe: "piper" };
  }
  throw new VoiceError(`Piper has no working build for ${platform}/${arch}: use voice.provider "command" with Piper for Python (pip install piper-tts), or a cloud voice.`, false);
}

/** Default voices with a clean license chain: LJ Speech is public domain; carlfm was trained from scratch on public-domain data. */
export const PIPER_VOICES: Record<Lang, string> = { es: "es_ES-carlfm-x_low", en: "en_US-ljspeech-medium" };

/** SHA-256 of the .onnx of the voices checked for this release (X-Linked-ETag at the pinned revision). */
const CHECKED_VOICES: Record<string, string> = {
  "en_US-ljspeech-medium": "6f52a751e2349abe7a76735eb09dc1875298c77ea2342ffd2fef79ff81b87f22",
  "es_ES-carlfm-x_low": "d69677323a907cd4963f42b29c20a98b5d6bfa7f3e64df339915e4650c00d125",
  "es_MX-ald-medium": "019b3803293c93e34a206dd2e53a3889209a514e786fd7144f7b70196c579b63",
  "es_ES-davefx-medium": "6658b03b1a6c316ee4c265a9896abc1393353c2d9e1bca7d66c2c442e222a917",
};

/** Where a catalog voice lives: "es_MX-ald-medium" → es/es_MX/ald/medium/es_MX-ald-medium.onnx at the pinned revision. */
export function piperVoiceUrls(name: string): { onnx: string; json: string; sha256?: string } {
  const match = /^([a-z]{2,3})_([A-Z]{2})-([a-z0-9_]+)-(x_low|low|medium|high)$/.exec(name);
  if (!match) throw new VoiceError(`"${name}" is not a Piper voice name such as es_MX-ald-medium.`, false);
  const [, family, region, speaker, quality] = match;
  const onnx = `${VOICES_BASE}/${family}/${family}_${region}/${speaker}/${quality}/${name}.onnx`;
  return { onnx, json: `${onnx}.json`, sha256: CHECKED_VOICES[name] };
}

/** Downloads through a temporary file and keeps it only when its SHA-256 matches (when one is known). */
export async function download(url: string, dest: string, o: { sha256?: string; fetchImpl?: typeof fetch } = {}): Promise<void> {
  const response = await (o.fetchImpl ?? fetch)(url);
  if (!response.ok || !response.body) throw new VoiceError(`Download failed (${response.status}): ${url}`);
  const partial = `${dest}.${randomBytes(4).toString("hex")}.part`;
  const hash = createHash("sha256");
  const file = createWriteStream(partial);
  try {
    for await (const chunk of response.body as unknown as AsyncIterable<Uint8Array>) {
      hash.update(chunk);
      if (!file.write(chunk)) await once(file, "drain");
    }
    file.end();
    await finished(file);
    const digest = hash.digest("hex");
    if (o.sha256 && digest !== o.sha256) throw new VoiceError(`The download of ${url} does not match its SHA-256 (got ${digest}).`);
    await rename(partial, dest);
  } catch (error) {
    file.destroy();
    throw error;
  } finally {
    await rm(partial, { force: true });
  }
}

async function extractArchive(archive: string, dir: string): Promise<void> {
  // Windows 10+ ships bsdtar, which also reads .zip; a tar from Git or MSYS earlier on PATH would not.
  const tar = process.platform === "win32" ? join(process.env.SystemRoot ?? "C:\\Windows", "System32", "tar.exe") : "tar";
  await run(tar, ["-xf", archive, "-C", dir]);
}

const inFlight = new Map<string, Promise<unknown>>();
/** One download per path at a time, even when several steps ask for it together. */
function single<T>(key: string, task: () => Promise<T>): Promise<T> {
  const running = inFlight.get(key) as Promise<T> | undefined;
  if (running) return running;
  const started = task().finally(() => inFlight.delete(key));
  inFlight.set(key, started);
  return started;
}

export interface EngineOptions {
  home: string;
  platform?: NodeJS.Platform;
  arch?: string;
  /** Test seams. */
  asset?: PiperAsset;
  fetchImpl?: typeof fetch;
  extract?: (archive: string, dir: string) => Promise<void>;
  log?: (message: string) => void;
  lang?: Lang;
}

/** Installs the engine once into <home>/piper/<release>/piper and returns its folder and executable. */
export async function ensurePiperEngine(o: EngineOptions): Promise<{ dir: string; exe: string }> {
  const asset = o.asset ?? piperAsset(o.platform ?? process.platform, o.arch ?? process.arch);
  const root = join(o.home, "piper", PIPER_RELEASE);
  const dir = join(root, "piper");
  const exe = join(dir, asset.exe);
  if (existsSync(exe)) return { dir, exe };
  return single(root, async () => {
    o.log?.(t(o.lang ?? "es", "piper.engine", { release: PIPER_RELEASE, dir: root }));
    await mkdir(root, { recursive: true });
    const staging = await mkdtemp(join(root, "staging-"));
    try {
      const archive = join(staging, asset.file);
      await download(`${ENGINE_BASE}/${asset.file}`, archive, { sha256: asset.sha256, fetchImpl: o.fetchImpl });
      await (o.extract ?? extractArchive)(archive, staging);
      if (!existsSync(join(staging, "piper", asset.exe))) throw new VoiceError("The Piper archive does not contain its executable.");
      await rm(join(staging, "piper", "libtashkeel_model.ort"), { force: true }); // Arabic-only model, 10 MB
      await rename(join(staging, "piper"), dir).catch((error: unknown) => {
        if (!existsSync(exe)) throw error;
      });
    } finally {
      await rm(staging, { recursive: true, force: true });
    }
    return { dir, exe };
  });
}

/** Downloads a catalog voice once into the engine's voices/ folder; returns its path relative to the engine. */
export async function ensurePiperVoice(o: { engineDir: string; name: string; fetchImpl?: typeof fetch; log?: (message: string) => void; lang?: Lang }): Promise<string> {
  const relative = `voices/${o.name}.onnx`;
  const onnx = join(o.engineDir, "voices", `${o.name}.onnx`);
  if (existsSync(onnx) && existsSync(`${onnx}.json`)) return relative;
  const urls = piperVoiceUrls(o.name);
  return single(onnx, async () => {
    o.log?.(t(o.lang ?? "es", "piper.voice", { voice: o.name }));
    await mkdir(join(o.engineDir, "voices"), { recursive: true });
    await download(urls.json, `${onnx}.json`, { fetchImpl: o.fetchImpl });
    await download(urls.onnx, onnx, { sha256: urls.sha256, fetchImpl: o.fetchImpl });
    return relative;
  });
}

export type PiperRunner = (exe: string, args: string[], o: { cwd: string; input: string }) => Promise<void>;

const runPiper: PiperRunner = (exe, args, o) =>
  new Promise((done, fail) => {
    const child = spawn(exe, args, { cwd: o.cwd, windowsHide: true, stdio: ["pipe", "ignore", "pipe"] });
    let stderr = "";
    child.stderr.on("data", (chunk: Buffer) => {
      stderr = (stderr + chunk.toString()).slice(-2000);
    });
    child.on("error", fail);
    child.on("close", (code) => (code === 0 ? done() : fail(Object.assign(new Error(stderr.trim() || `exit code ${code}`), { code }))));
    child.stdin.end(o.input, "utf8");
  });

/** 0xC0000135, "a DLL was not found": on Windows that is the Visual C++ runtime Piper needs. */
const MISSING_DLL = new Set([3221225781, -1073741515]);

export function createPiperProvider(o: EngineOptions & { voices?: LocalizedText; ffmpeg: () => Promise<string>; run?: PiperRunner }): VoiceProvider {
  return {
    id: "piper",
    model: PIPER_RELEASE,
    voiceFor: (lang) => o.voices?.[lang] ?? PIPER_VOICES[lang],
    async synthesize(request) {
      const name = request.voice ?? o.voices?.[request.lang] ?? PIPER_VOICES[request.lang];
      const engine = await ensurePiperEngine(o);
      const model = await ensurePiperVoice({ engineDir: engine.dir, name, fetchImpl: o.fetchImpl, log: o.log, lang: o.lang });
      const out = `out-${randomBytes(6).toString("hex")}.wav`;
      const wav = join(engine.dir, out);
      // Relative ASCII arguments from the engine's folder: Piper 2023 garbles non-ASCII paths on Windows.
      const args = [
        "--model", model, "--config", `${model}.json`, "--output_file", out,
        "--length_scale", String(Math.round((1 / request.speed) * 100) / 100), "--espeak_data", "espeak-ng-data", "-q",
      ];
      try {
        try {
          await (o.run ?? runPiper)(engine.exe, args, { cwd: engine.dir, input: request.text });
        } catch (error) {
          const code = (error as { code?: unknown }).code;
          if (typeof code === "number" && MISSING_DLL.has(code)) {
            throw new VoiceError("Piper needs the Microsoft Visual C++ runtime: install it from https://aka.ms/vs/17/release/vc_redist.x64.exe", false);
          }
          throw new VoiceError(`Piper failed: ${((error as Error).message.split("\n")[0] ?? "").slice(0, 200)}`, false);
        }
        if (!existsSync(wav)) throw new VoiceError("Piper wrote no audio.", false);
        return await toMp3(wav, `${wav}.mp3`, await o.ffmpeg());
      } finally {
        await rm(wav, { force: true });
        await rm(`${wav}.mp3`, { force: true });
      }
    },
  };
}
