import type { Lang } from "@explicame/core";

export interface NarratorOptions {
  muted: boolean;
  rate: number;
  volume: number;
}

export interface Narration {
  done: Promise<void>;
  stop(): void;
  pause(): void;
  resume(): void;
  update(o: NarratorOptions): void;
}

export type Narrator = (text: string, lang: Lang, audioUrl: string | undefined, o: NarratorOptions) => Narration;

/** How long a narration takes when there is nothing to listen to (~15 characters per second). */
export function estimateMs(text: string, rate = 1): number {
  return Math.max(1500, text.length * 65) / rate;
}

function timer(ms: number, onDone: () => void) {
  let remaining = ms;
  let started = Date.now();
  let handle = setTimeout(onDone, remaining);
  return {
    pause() {
      clearTimeout(handle);
      remaining -= Date.now() - started;
    },
    resume() {
      started = Date.now();
      handle = setTimeout(onDone, Math.max(0, remaining));
    },
    stop() {
      clearTimeout(handle);
    },
  };
}

/** Plays the step's MP3; without one, the browser voice; if neither works, waits the estimated time. Never hangs. */
export const defaultNarrator: Narrator = (text, lang, audioUrl, options) => {
  let finish!: () => void;
  let finished = false;
  const done = new Promise<void>((resolve) => {
    finish = () => {
      if (!finished) {
        finished = true;
        resolve();
      }
    };
  });
  let fallback: ReturnType<typeof timer> | null = null;
  const useTimer = () => {
    if (!fallback && !finished) fallback = timer(estimateMs(text, options.rate), finish);
  };
  let audio: HTMLAudioElement | null = null;
  let speaking = false;
  let watchdog: ReturnType<typeof timer> | null = null;

  if (audioUrl && typeof Audio !== "undefined") {
    audio = new Audio(audioUrl);
    audio.muted = options.muted;
    audio.volume = options.volume;
    audio.playbackRate = options.rate;
    audio.addEventListener("ended", finish);
    audio.addEventListener("error", useTimer);
    // A stream that stalls fires neither ended nor error: never wait forever (paused time does not count).
    watchdog = timer(estimateMs(text, options.rate) * 2 + 5000, finish);
    void done.then(() => watchdog?.stop());
    try {
      const started = audio.play() as Promise<void> | undefined;
      if (started && typeof started.catch === "function") started.catch(useTimer);
      else useTimer();
    } catch {
      useTimer();
    }
  } else if (typeof speechSynthesis !== "undefined" && typeof SpeechSynthesisUtterance !== "undefined") {
    const utterance = new SpeechSynthesisUtterance(text);
    utterance.lang = lang === "es" ? "es-ES" : "en-US";
    utterance.rate = options.rate;
    utterance.volume = options.muted ? 0 : options.volume;
    utterance.onend = finish;
    utterance.onerror = useTimer;
    speechSynthesis.cancel();
    speechSynthesis.speak(utterance);
    speaking = true;
    // Some browsers never fire onend (no voices installed, long texts): never wait forever.
    setTimeout(finish, estimateMs(text, options.rate) * 2 + 2000);
  } else {
    useTimer();
  }

  return {
    done,
    stop() {
      audio?.pause();
      if (speaking) speechSynthesis.cancel();
      fallback?.stop();
      watchdog?.stop();
      finish();
    },
    pause() {
      audio?.pause();
      if (speaking) speechSynthesis.pause();
      fallback?.pause();
      watchdog?.pause();
    },
    resume() {
      if (audio && !fallback) void Promise.resolve(audio.play()).catch(useTimer);
      if (speaking) speechSynthesis.resume();
      fallback?.resume();
      watchdog?.resume();
    },
    update(o) {
      if (!audio) return;
      audio.muted = o.muted;
      audio.volume = o.volume;
      audio.playbackRate = o.rate;
    },
  };
};
