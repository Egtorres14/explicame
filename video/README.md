# Video explicativo · Explainer video

**ES** · El video de explicame lo hace explicame: la narración pasa por `explicame voice`, el clip es una
grabación de `explicame record` y `render.mjs` captura cuadro a cuadro (30 fps) la línea de tiempo GSAP de
`index.html`.

1. `npm run build` en la raíz.
2. Graba la guía de la app de ejemplo (servida en http://localhost:5173), en `examples/demo-app`:
   `node ../../packages/cli/dist/bin.js record public/explicame/filtrar-reportes-por-fecha/guide.json`
   (la guía ya trae su audio; `record` solo escribe en `.explicame/videos/`, que no se versiona).
3. `npm run video` (o `npm run video -- --lang es`). Los MP4 quedan en `video/out/`.

Narración con ElevenLabs v4: define `ELEVENLABS_API_KEY`, `EXPLICAME_VIDEO_VOICE_ES` y `EXPLICAME_VIDEO_VOICE_EN`
antes del paso 3. Sin ellas se usa Piper, gratis y local. El video publicado usa Lumina (`x5IDPSl4ZUbhosMmVFTk`)
y Nichalia Schwartz (`XfNU2rGpBa01ckF309OY`). En `script.json`, `es_say`/`en_say` es lo que lee la voz cuando
difiere del rótulo.

**EN** · explicame makes its own video: the narration goes through `explicame voice`, the clip is an
`explicame record` recording, and `render.mjs` captures the GSAP timeline in `index.html` frame by frame (30 fps).
Steps as above; set `ELEVENLABS_API_KEY`, `EXPLICAME_VIDEO_VOICE_ES` and `EXPLICAME_VIDEO_VOICE_EN` for
ElevenLabs v4 narration, otherwise Piper is used. The published video uses Lumina (`x5IDPSl4ZUbhosMmVFTk`) and
Nichalia Schwartz (`XfNU2rGpBa01ckF309OY`). In `script.json`, `es_say`/`en_say` is what the voice reads when it
differs from the caption.
