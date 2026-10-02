/* global gsap */
// The whole video is one paused GSAP timeline: render.mjs seeks it frame by frame, so nothing depends on real time.
const lang = new URLSearchParams(location.search).get("lang") === "en" ? "en" : "es";

const TEXT = {
  es: {
    subtitle: "Onboarding narrado para cada funcionalidad nueva",
    video: "Grabar un video", manual: "Escribir un manual", oneOnOne: "Explicar uno por uno",
    late: "Siempre llega tarde", question: "¿Y si la explicación se generara sola?",
    diff: "diff de git", explore: "explora tu app", script: "guion verificado", voice: "voz ES · EN", output: "guía + video",
    s1: "Abre el filtro", s2: "Elige el rango de fechas", s3: "Agrupa por semana",
    reports: "Reportes", filterBtn: "Filtrar por fecha", inApp: "Guía en tu app", mp4: "Video MP4",
    safety: "Nada se guarda en tu app", save: "Guardar", pointed: "Se señala, no se pulsa", blocked: "bloqueada",
    plugin: "Plugin de Claude Code", pluginSub: "Con tu propia cuenta de Claude", api: "API key de Claude", apiSub: "Con tu clave de Anthropic",
    free: "gratis", own: "Comando propio",
    demoTitle: "La app de ejemplo", demoSub: "Guía escrita por Claude Code con explicame · grabada por explicame",
    open: "Código abierto · MIT",
  },
  en: {
    subtitle: "Narrated onboarding for every new feature",
    video: "Record a video", manual: "Write a manual", oneOnOne: "Explain it one by one",
    late: "Always too late", question: "What if the explanation wrote itself?",
    diff: "git diff", explore: "explores your app", script: "verified script", voice: "voice ES · EN", output: "guide + video",
    s1: "Open the filter", s2: "Pick the date range", s3: "Group by week",
    reports: "Reports", filterBtn: "Filter by date", inApp: "Guide in your app", mp4: "MP4 video",
    safety: "Nothing is saved to your app", save: "Save", pointed: "Pointed at, never clicked", blocked: "blocked",
    plugin: "Claude Code plugin", pluginSub: "With your own Claude account", api: "Claude API key", apiSub: "With your Anthropic key",
    free: "free", own: "Your own command",
    demoTitle: "The demo app", demoSub: "Guide written by Claude Code with explicame · recorded by explicame",
    open: "Open source · MIT",
  },
}[lang];

const ICONS = {
  camera: '<svg viewBox="0 0 24 24"><rect x="2" y="6" width="14" height="12" rx="2"/><path d="M16 10l6-3v10l-6-3z"/></svg>',
  doc: '<svg viewBox="0 0 24 24"><path d="M6 2h9l5 5v15H6z"/><path d="M15 2v5h5M9 13h8M9 17h6"/></svg>',
  people: '<svg viewBox="0 0 24 24"><circle cx="8" cy="8" r="3"/><circle cx="17" cy="9" r="2.5"/><path d="M2 20c0-3.5 3-6 6-6s6 2.5 6 6M14 20c0-2.5 1.5-4.5 4-4.5s4 2 4 4.5"/></svg>',
  code: '<svg viewBox="0 0 24 24"><path d="M8 7l-5 5 5 5M16 7l5 5-5 5M13.5 4l-3 16"/></svg>',
  browser: '<svg viewBox="0 0 24 24"><rect x="2" y="4" width="20" height="16" rx="2"/><path d="M2 9h20M6 6.5h.01M9 6.5h.01"/><circle cx="12" cy="15" r="2.5"/></svg>',
  check: '<svg viewBox="0 0 24 24"><circle cx="12" cy="12" r="10"/><path d="M7 12.5l3.2 3L17 9"/></svg>',
  wave: '<svg viewBox="0 0 24 24"><path d="M3 10v4M7 7v10M11 4v16M15 8v8M19 6v12"/></svg>',
  play: '<svg viewBox="0 0 24 24"><circle cx="12" cy="12" r="10"/><path d="M10 8l6 4-6 4z"/></svg>',
  ring: '<svg viewBox="0 0 24 24"><path d="M11 21H5a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h14a2 2 0 0 1 2 2v6"/><path d="M3 8h18"/><rect x="6.5" y="11.5" width="4" height="4" rx="1"/><path d="M13 13l8 3-3.5 1.3L16 21z"/></svg>',
  shield: '<svg viewBox="0 0 24 24"><path d="M12 2l8 3v6c0 5-3.5 9-8 11-4.5-2-8-6-8-11V5z"/><path d="M8.5 12l2.5 2.5 4.5-5"/></svg>',
  plug: '<svg viewBox="0 0 24 24"><path d="M9 2v5M15 2v5M6 7h12v4a6 6 0 01-12 0zM12 17v5"/></svg>',
  key: '<svg viewBox="0 0 24 24"><circle cx="7.5" cy="15.5" r="4.5"/><path d="M11 12l9-9M16 7l3 3M14 9l2 2"/></svg>',
};

for (const node of document.querySelectorAll("[data-t]")) node.textContent = TEXT[node.dataset.t];
for (const node of document.querySelectorAll("[data-icon]")) node.innerHTML = ICONS[node.dataset.icon];
const wave = document.querySelector(".wave");
for (let i = 0; i < 24; i++) wave.append(document.createElement("i"));

const tl = gsap.timeline({ paused: true });
let captions = [];
let clip = null;

const show = (target, at, from = { opacity: 0, y: 40 }, duration = 0.7) =>
  tl.fromTo(target, from, { opacity: 1, x: 0, y: 0, scale: 1, duration, ease: "power3.out" }, at);
const hide = (target, at, duration = 0.45) => tl.to(target, { opacity: 0, duration, ease: "power2.in" }, at);
const span = (chunk) => chunk.end - chunk.start;

const builders = {
  intro(s) {
    const [c1, c2] = s.chunks;
    tl.set("#s-intro", { opacity: 1 }, s.start);
    show("#s-intro .title", s.start + 0.05, { opacity: 0, y: 70, scale: 0.94 }, 0.9);
    show("#s-intro .subtitle", s.start + 0.45);
    tl.to("#s-intro .hero", { y: -240, scale: 0.62, duration: 0.8, ease: "power3.inOut" }, c1.start + 1.2);
    show("#logo", c1.start + 1.6, { opacity: 0, x: -24 }, 0.6);
    tl.to("#s-intro .hero", { opacity: 0, duration: 0.5 }, c1.start + 1.7);
    tl.fromTo("#s-intro .card", { opacity: 0, y: 70 }, { opacity: 1, y: 0, duration: 0.7, stagger: 0.2, ease: "back.out(1.4)" }, c1.start + 1.9);
    tl.to("#s-intro .card", { opacity: 0, y: -40, duration: 0.5, stagger: 0.08, ease: "power2.in" }, c2.start - 0.1);
    // After the cards have left: they fade out until about c2.start + 0.56 and sit where the clock appears.
    show("#s-intro .late", c2.start + 0.6, { opacity: 0, scale: 0.85 });
    tl.fromTo("#s-intro .hand", { rotation: 0 }, { rotation: 720, svgOrigin: "60 60", duration: 2.4, ease: "power1.inOut" }, c2.start + 0.6);
    show("#s-intro .question", c2.start + Math.min(2.3, span(c2) * 0.42), { opacity: 0, y: 30 }, 0.8);
    hide("#s-intro", s.end - 0.45);
  },

  flow(s) {
    const [c3, c4, c5] = s.chunks;
    tl.set("#s-flow", { opacity: 1 }, s.start);
    tl.fromTo("#s-flow .node", { opacity: 0, y: 40 }, { opacity: 1, y: 0, duration: 0.5, stagger: 0.12, ease: "power3.out" }, s.start + 0.1);
    const moments = [c3.start, c3.start + span(c3) * 0.45, c4.start, c4.start + span(c4) * 0.62, c5.start];
    const details = ["#d-diff", "#d-browser", "#d-script", "#d-voice", "#d-output"];
    moments.forEach((at, i) => {
      const node = `#s-flow .node:nth-child(${i + 1})`;
      tl.to(`${node} i`, { borderColor: "#8b85ff", color: "#eef0f8", backgroundColor: "rgba(139,133,255,0.22)", scale: 1.08, duration: 0.4, ease: "back.out(2)" }, at);
      tl.to(node, { color: "#eef0f8", duration: 0.3 }, at);
      if (i > 0) tl.to(`#s-flow .links path:nth-child(${i})`, { strokeDashoffset: 0, stroke: "#8b85ff", duration: 0.5, ease: "power2.out" }, at - 0.3);
      if (i > 0) hide(details[i - 1], at - 0.05, 0.3);
      show(details[i], at + 0.15, { opacity: 0, y: 30, scale: 0.97 }, 0.55);
    });
    tl.fromTo("#d-browser .ring", { opacity: 0, scale: 1.4 }, { opacity: 1, scale: 1, duration: 0.5, ease: "back.out(2)" }, moments[1] + 0.9);
    tl.fromTo("#d-script li", { opacity: 0, x: -30 }, { opacity: 1, x: 0, duration: 0.45, stagger: 0.45, ease: "power3.out" }, moments[2] + 0.4);
    tl.fromTo(".wave i", { scaleY: 0.2 }, { scaleY: 1, duration: 0.32, ease: "sine.inOut", repeat: 9, yoyo: true, stagger: { each: 0.05, from: "center" } }, moments[3] + 0.2);
    tl.fromTo("#d-output .tile", { opacity: 0, y: 40 }, { opacity: 1, y: 0, duration: 0.5, stagger: 0.25, ease: "back.out(1.6)" }, moments[4] + 0.25);
    hide("#s-flow", s.end - 0.45);
  },

  safety(s) {
    const [c6] = s.chunks;
    tl.set("#s-safety", { opacity: 1 }, s.start);
    show("#s-safety .headline", s.start + 0.05);
    show("#s-safety .shield", s.start + 0.3, { opacity: 0, scale: 0.6 }, 0.8);
    show("#s-safety .item:nth-child(1)", c6.start + span(c6) * 0.2, { opacity: 0, x: 60 });
    tl.fromTo("#s-safety .item:nth-child(1) .ring", { opacity: 0, scale: 1.3 }, { opacity: 1, scale: 1, duration: 0.5, ease: "back.out(2)" }, c6.start + span(c6) * 0.28);
    show("#s-safety .item:nth-child(2)", c6.start + span(c6) * 0.55, { opacity: 0, x: 60 });
    tl.to("#s-safety .strike", { width: "calc(100% - 210px)", duration: 0.45, ease: "power2.out" }, c6.start + span(c6) * 0.66);
    hide("#s-safety", s.end - 0.45);
  },

  modes(s) {
    const [c7, c8] = s.chunks;
    tl.set("#s-modes", { opacity: 1 }, s.start);
    tl.fromTo("#s-modes .mode", { opacity: 0, y: 60 }, { opacity: 1, y: 0, duration: 0.7, stagger: 0.35, ease: "power3.out" }, s.start + 0.1);
    tl.to("#s-modes .mode", { opacity: 0, y: -60, scale: 0.9, duration: 0.5, ease: "power2.in" }, c8.start - 0.1);
    show("#s-modes .panel-shot", c8.start + 0.25, { opacity: 0, y: 80, scale: 0.94 }, 0.9);
    tl.fromTo("#s-modes .chips span", { opacity: 0, y: 24 }, { opacity: 1, y: 0, duration: 0.4, stagger: 0.18, ease: "back.out(1.8)" }, c8.start + span(c8) * 0.45);
    hide("#s-modes", s.end - 0.45);
  },

  demo(s) {
    tl.set("#s-demo", { opacity: 1 }, s.start);
    show("#s-demo .demo-head", s.start + 0.1);
    tl.to("#s-demo .demo-head", { opacity: 0, y: -40, duration: 0.45 }, s.clip.start - 0.7);
    show("#s-demo .window.big", s.clip.start - 0.5, { opacity: 0, scale: 0.92 }, 0.6);
    // The clip window covers the top-left corner: the logo steps aside while it plays.
    tl.to("#logo", { opacity: 0, duration: 0.3 }, s.clip.start - 0.6);
    hide("#s-demo", s.end - 0.45);
  },

  outro(s) {
    tl.set("#s-outro", { opacity: 1 }, s.start);
    tl.to("#logo", { opacity: 0, duration: 0.4 }, s.start);
    show("#s-outro .title", s.start + 0.1, { opacity: 0, y: 60, scale: 0.94 }, 0.9);
    show("#s-outro .tagline", s.start + 0.7);
    show("#s-outro .url", s.start + 1.1, { opacity: 0, scale: 0.9 });
    tl.fromTo("#s-outro .chips span", { opacity: 0, y: 24 }, { opacity: 1, y: 0, duration: 0.4, stagger: 0.15, ease: "back.out(1.8)" }, s.start + 1.6);
    tl.to("#stage", { opacity: 0, duration: 0.6 }, s.end - 0.6);
  },
};

/** Builds the timeline from render.mjs's timing and loads the clip; resolves with the total duration. */
window.__setup = async (timing) => {
  document.querySelector(".panel-shot").src = timing.panel;
  for (const scene of timing.scenes) {
    builders[scene.id](scene);
    captions.push(...scene.chunks.map((chunk) => ({ start: chunk.start, end: chunk.end + 0.25, text: chunk.text })));
    if (scene.clip) {
      const el = document.querySelector(".clip");
      el.src = scene.clip.src;
      await new Promise((resolve, reject) => {
        el.addEventListener("loadeddata", resolve, { once: true });
        el.addEventListener("error", () => reject(new Error(`cannot load ${scene.clip.src}`)), { once: true });
      });
      clip = { el, start: scene.clip.start, duration: scene.clip.duration };
      captions.push(...scene.clip.cues);
    }
  }
  tl.set({}, {}, timing.duration);
  await document.fonts.ready;
  return tl.duration();
};

/** Shows exactly time t: timeline, clip frame and caption. */
window.__seek = async (t) => {
  tl.seek(t, false);
  const caption = captions.find((c) => t >= c.start && t < c.end);
  const box = document.getElementById("caption");
  box.textContent = caption ? caption.text : "";
  box.style.opacity = caption ? "1" : "0";
  if (clip) {
    const local = Math.min(Math.max(t - clip.start, 0), clip.duration - 0.04);
    if (Math.abs(clip.el.currentTime - local) > 0.001) {
      await new Promise((resolve) => {
        clip.el.addEventListener("seeked", resolve, { once: true });
        clip.el.currentTime = local;
      });
    }
  }
  await new Promise((resolve) => requestAnimationFrame(() => requestAnimationFrame(resolve)));
};
