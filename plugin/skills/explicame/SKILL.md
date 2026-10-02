---
name: explicame
description: Genera la guía de onboarding interactiva y narrada (ES/EN) de una funcionalidad nueva de una app web a partir de su diff, explorando la app real con las herramientas del servidor MCP de explicame. Úsala cuando pidan explicar, documentar o crear el onboarding o el tutorial de un cambio. Generates the narrated in-app onboarding guide of a new feature from its diff.
argument-hint: "[qué hace la funcionalidad / what the feature does]"
allowed-tools: Bash(git diff:*), Bash(git log:*), Bash(git status:*), Bash(explicame build:*), Read, Glob, Grep, mcp__plugin_explicame_explicame__observe, mcp__plugin_explicame_explicame__act, mcp__plugin_explicame_explicame__add_step, mcp__plugin_explicame_explicame__finish
---

# explicame: the narrated guide of a new feature

You write the onboarding guide of a new feature of the web app in this project. The explicame MCP server gives you a real browser on the running app through four tools (observe, act, add_step and finish), and its instructions explain how to use them. Every step you add is replayed later inside the app with a highlight ring and a narrated voice, in every language of the project.

What the user says about the feature (may be empty): $ARGUMENTS

Talk to the user in their language. Narrations and titles go in every language of the project.

## 1. Prepare

1. Read `explicame.config.json` at the project root if it exists: `appUrl` (default http://localhost:5173), `startUrl`, `base` (default main), `languages`, `maxSteps` and `outputDir`. It never holds API keys.
2. Read the change: `git diff <base>...HEAD`, plus `git status` and `git diff` for work that is not committed yet. Open the UI files you need to understand what the learner will see, and use any files or description the user gave you.
3. Plan the guide before exploring: what the feature is for, which screens it touches, and the 3 to `maxSteps` steps that show it.

## 2. Explore and add steps

- Start with observe. If it says the app cannot be reached, ask the user to start it (for example `npm run dev`) and stop.
- Use act to reach the screen where the feature lives, and add_step for each thing the learner should see or do, following the server's instructions.
- Never try to get around a rejected action: buttons that save, send, delete, pay, confirm or publish are only pointed at.
- End with finish and a short title in every language.

## 3. Verification

finish replays the whole guide in a fresh browser:

- If every step passes, the guide is saved and the result gives you its path and the next command.
- If a step fails, the result says which one and shows the screen right before it. Call add_step once with the replacement for that step (observe or act first if you need to). The guide is verified again automatically.
- Each step gets one repair. If it fails again, the guide is not saved: tell the user which step failed, why, and where the screenshot is.

## 4. Voice and video

Run the command from the result: `explicame build --from-guide <path>`. Add `--video` for one MP4 per language (it needs ffmpeg). It uses the voice set in explicame.config.json and calls no AI. If the shell says `explicame` is not found, the user has to run `npm link -w explicame` once in their clone of explicame (see the plugin's README).

## 5. Report

Tell the user the guide's title, how many steps it has, where `guide.json` is, which audio or video files were created, and how to show the guide in the app:

~~~html
<script src="/explicame/explicame-player.js"></script>
<script>Explicame.mount()</script>
~~~
