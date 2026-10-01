# explicame / explain-me

**ES** · Genera el onboarding narrado de cada funcionalidad nueva a partir del diff de tu código: la IA
explora tu app real, escribe la guía en español e inglés, le pone voz y entrega una guía interactiva
dentro de la app y un video MP4.

**EN** · Generates narrated onboarding for every new feature straight from your code diff: the AI
explores your running app, writes the guide in Spanish and English, voices it, and ships an
in-app interactive guide plus an MP4 video.

> 🚧 **En construcción / Work in progress** — v0.1 en desarrollo. El diseño completo está en
> [`docs/superpowers/specs/2026-10-01-explicame-design.md`](docs/superpowers/specs/2026-10-01-explicame-design.md).

## Cómo funcionará

```
diff de git → la IA explora la app real → guion bilingüe verificado → voz → guía interactiva + video MP4
```

- **Dos modos de IA:** como plugin de Claude Code (con tu propia cuenta de Claude) o con una API key
  de Claude.
- **La IA no inventa a qué apuntar:** recorre la app en un navegador sin ventana y cada paso queda
  verificado contra la pantalla real.
- **Nada se guarda en tu app:** durante la generación, la verificación, la grabación y la
  reproducción se bloquea toda petición que escriba datos.
- **Voces a elegir:** ElevenLabs, Deepgram, OpenAI, o gratis y en local con Piper o tu propio comando.
- **Bilingüe:** panel, CLI, reproductor y narración en español e inglés.

## How it will work

- **Two AI modes:** a Claude Code plugin (your own Claude account) or a Claude API key.
- **Grounded, not guessed:** the AI explores the app in a headless browser and every step is
  verified against the real UI.
- **Read-only by design:** write requests are blocked while generating, verifying, recording and
  playing guides.
- **Pick your voice:** ElevenLabs, Deepgram, OpenAI, or free and local with Piper or your own command.

## Origen

La idea nació en la función «¿Cómo funciona?» que construí para una plataforma de operaciones en
producción: guiones escritos a mano que recorren la pantalla real con voz. explicame hace que la IA
escriba esos guiones sola, para cualquier app web.

## Licencia / License

MIT © 2026 Gabriel Torres Mendivil
