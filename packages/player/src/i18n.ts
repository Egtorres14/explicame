import type { Lang } from "@explicame/core";

export const UI = {
  es: {
    howItWorks: "¿Cómo funciona?",
    noGuides: "No hay guías para esta pantalla.",
    step: "Paso {n} de {total}",
    pause: "Pausar",
    resume: "Seguir",
    next: "Siguiente",
    prev: "Anterior",
    exit: "Salir",
    mute: "Silenciar",
    unmute: "Activar voz",
    speed: "Velocidad",
    volume: "Volumen",
    language: "Idioma",
  },
  en: {
    howItWorks: "How does it work?",
    noGuides: "There are no guides for this screen.",
    step: "Step {n} of {total}",
    pause: "Pause",
    resume: "Resume",
    next: "Next",
    prev: "Back",
    exit: "Exit",
    mute: "Mute",
    unmute: "Unmute",
    speed: "Speed",
    volume: "Volume",
    language: "Language",
  },
} as const;

export type UiKey = keyof (typeof UI)["es"];

export function ui(lang: Lang, key: UiKey, params: Record<string, string | number> = {}): string {
  return UI[lang][key].replace(/\{(\w+)\}/g, (match, name: string) => (name in params ? String(params[name]) : match));
}
