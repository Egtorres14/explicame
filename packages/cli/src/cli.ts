import Anthropic from "@anthropic-ai/sdk";
import { Command } from "commander";
import { dirname, resolve } from "node:path";
import { AppUnreachableError, openSession } from "./browser/session.js";
import { build } from "./build.js";
import { ConfigError, loadConfig, type Config } from "./config.js";
import { explicameHome, loadCredentials, type Credentials } from "./credentials.js";
import { createFakeDriver, loadFakeScript } from "./generate/fakeDriver.js";
import { LoopError } from "./generate/loop.js";
import { login } from "./login.js";
import { readGuide, writeGuide } from "./output.js";
import { VerifyError, verifyGuide } from "./verify.js";
import { createFakeVoiceProvider } from "./voice/fake.js";
import { buildVoiceProviders } from "./voice/index.js";
import { VoiceError, voiceGuide } from "./voice/provider.js";

export function exitCodeFor(error: unknown): number {
  if (error instanceof VerifyError || error instanceof LoopError) return 1;
  if (error instanceof ConfigError || error instanceof Anthropic.AuthenticationError) return 2;
  if (error instanceof AppUnreachableError) return 3;
  if (error instanceof VoiceError || error instanceof Anthropic.APIConnectionError || error instanceof Anthropic.RateLimitError) return 4;
  if (error instanceof Anthropic.APIError && typeof error.status === "number" && error.status >= 500) return 4;
  return 1;
}

interface RunContext {
  cwd: string;
  config: Config;
  credentials: Credentials;
  log: (message: string) => void;
}

async function run(task: (ctx: RunContext) => Promise<unknown>): Promise<void> {
  try {
    const cwd = process.cwd();
    const config = await loadConfig(cwd);
    const credentials = await loadCredentials();
    await task({ cwd, config, credentials, log: (message) => console.log(message) });
  } catch (error) {
    console.error(error instanceof Error ? error.message : String(error));
    process.exitCode = exitCodeFor(error);
  }
}

const list = (value: string | undefined) => (value ? value.split(",").map((s) => s.trim()).filter(Boolean) : undefined);

export function createProgram(): Command {
  const program = new Command();
  program
    .name("explicame")
    .description("Onboarding narrado para cada funcionalidad nueva · Narrated onboarding for every new feature")
    .version("0.1.0");

  program
    .command("build")
    .description("diff → exploración → guion verificado → voz · diff → exploration → verified script → voice")
    .option("--base <ref>", "rama base (por defecto la de explicame.config.json)")
    .option("--head <ref>", "rama o commit con la funcionalidad", "HEAD")
    .option("--diff-file <path>", "usar un archivo .patch en lugar de git")
    .option("--files <paths>", "archivos extra de contexto, separados por comas")
    .option("--describe <text>", "qué hace la funcionalidad, en una frase")
    .option("--id <id>", "id de la guía (kebab-case)")
    .option("--no-voice", "no generar audio")
    .action((opts: { base?: string; head: string; diffFile?: string; files?: string; describe?: string; id?: string; voice: boolean }) =>
      run(async ({ cwd, config, credentials, log }) => {
        // Testing hooks: a scripted fake AI and silent voices, so CI never needs keys.
        const fakeScript = process.env.EXPLICAME_FAKE_SCRIPT;
        await build({
          cwd, config, credentials, log,
          base: opts.base, head: opts.head, diffFile: opts.diffFile, files: list(opts.files),
          describe: opts.describe, id: opts.id, voice: opts.voice,
          driver: fakeScript ? createFakeDriver(await loadFakeScript(resolve(cwd, fakeScript))) : undefined,
          voiceProviders: process.env.EXPLICAME_FAKE_VOICE ? [createFakeVoiceProvider()] : undefined,
        });
      }),
    );

  program
    .command("verify <guide>")
    .description("reproduce una guía y comprueba cada paso · replays a guide and checks every step")
    .action((guidePath: string) =>
      run(async ({ cwd, config, log }) => {
        const guide = await readGuide(resolve(cwd, guidePath));
        const failure = (await verifyGuide(guide, () => openSession({ appUrl: config.appUrl, startUrl: guide.startUrl, allowRequests: config.safety.allowRequests, lang: config.uiLanguage })))[0];
        if (failure) throw new VerifyError(failure);
        log("OK");
      }),
    );

  program
    .command("voice <guide>")
    .description("genera o regenera el audio de una guía · (re)generates a guide's audio")
    .action((guidePath: string) =>
      run(async ({ cwd, config, credentials, log }) => {
        const file = resolve(cwd, guidePath);
        const guideDir = dirname(file);
        const voiced = await voiceGuide(await readGuide(file), {
          providers: process.env.EXPLICAME_FAKE_VOICE ? [createFakeVoiceProvider()] : buildVoiceProviders(config, credentials),
          guideDir, cacheDir: resolve(explicameHome(), "cache", "voice"),
          voices: config.voice.voices, speed: config.voice.speed, onWarn: log,
        });
        await writeGuide(dirname(guideDir), voiced);
        log("OK");
      }),
    );

  program
    .command("login")
    .description("inicia sesión en tu app una vez y guarda la sesión · log in to your app once and keep the session")
    .action(() => run(({ cwd, config, log }) => login({ cwd, config, log })));

  return program;
}
