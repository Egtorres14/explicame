import Anthropic from "@anthropic-ai/sdk";
import { Command } from "commander";
import { dirname, join, resolve } from "node:path";
import { t, type Lang } from "@explicame/core";
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
import { recordLanguages, RecordError } from "./record.js";
import { runMcpServer } from "./mcp/server.js";

export const VERSION = "0.1.0";

export function exitCodeFor(error: unknown): number {
  if (error instanceof VerifyError || error instanceof LoopError || error instanceof RecordError) return 1;
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

const recordAll = (ctx: RunContext, guidePath: string, langs?: Lang[]) =>
  recordLanguages({ guidePath: resolve(ctx.cwd, guidePath), config: ctx.config, cwd: ctx.cwd, home: explicameHome(), langs, log: ctx.log });

const langsOf = (value: string | undefined): Lang[] | undefined =>
  !value || value === "all" ? undefined : (value.split(",").map((s) => s.trim()) as Lang[]);

const list = (value: string | undefined) => (value ? value.split(",").map((s) => s.trim()).filter(Boolean) : undefined);

export function createProgram(): Command {
  const program = new Command();
  program
    .name("explicame")
    .description("Onboarding narrado para cada funcionalidad nueva · Narrated onboarding for every new feature")
    .version(VERSION);

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
    .option("--video", "grabar también el MP4 de cada idioma")
    .option("--from-guide <path>", "solo voz y publicación de una guía ya verificada (modo plugin), sin IA")
    .action((opts: { base?: string; head: string; diffFile?: string; files?: string; describe?: string; id?: string; voice: boolean; video?: boolean; fromGuide?: string }) =>
      run(async ({ cwd, config, credentials, log }) => {
        // Testing hooks: a scripted fake AI and silent voices, so CI never needs keys.
        const fakeScript = process.env.EXPLICAME_FAKE_SCRIPT;
        const result = await build({
          cwd, config, credentials, log,
          base: opts.base, head: opts.head, diffFile: opts.diffFile, files: list(opts.files),
          describe: opts.describe, id: opts.id, voice: opts.voice, fromGuide: opts.fromGuide,
          driver: fakeScript ? createFakeDriver(await loadFakeScript(resolve(cwd, fakeScript))) : undefined,
          voiceProviders: process.env.EXPLICAME_FAKE_VOICE ? [createFakeVoiceProvider()] : undefined,
        });
        if (opts.video) await recordAll({ cwd, config, credentials, log }, join(result.dir, "guide.json"));
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
          speed: config.voice.speed, onWarn: log,
        });
        await writeGuide(dirname(guideDir), voiced);
        log("OK");
      }),
    );

  program
    .command("record <guide>")
    .description("graba la guía como MP4 con subtítulos · records the guide as an MP4 with subtitles")
    .option("--lang <langs>", "es, en o all", "all")
    .action((guidePath: string, opts: { lang: string }) => run((ctx) => recordAll(ctx, guidePath, langsOf(opts.lang))));

  program
    .command("login")
    .description("inicia sesión en tu app una vez y guarda la sesión · log in to your app once and keep the session")
    .action(() => run(({ cwd, config, log }) => login({ cwd, config, log })));

  program
    .command("mcp")
    .description("servidor MCP para el plugin de Claude Code (stdio) · MCP server for the Claude Code plugin (stdio)")
    .action(async () => {
      // The plugin passes ${CLAUDE_PROJECT_DIR}; a value that still has "${" was not expanded by the client.
      const declared = process.env.EXPLICAME_PROJECT_DIR;
      const cwd = declared && !declared.includes("${") ? resolve(declared) : process.cwd();
      const cli = process.env.EXPLICAME_CLI;
      await runMcpServer({ cwd, home: explicameHome(), version: VERSION, cliCommand: cli ? `node "${cli}"` : "explicame" });
    });

  return program;
}
