import type { Action } from "@explicame/core";

const sleep = (ms: number) => new Promise<void>((resolve) => setTimeout(resolve, ms));
const INSTANT_TYPES = new Set(["date", "time", "datetime-local", "month", "week", "color", "range"]);

/** Uses the prototype's setter so frameworks that track the value (React) notice the change. */
function setNativeValue(el: HTMLInputElement | HTMLTextAreaElement, value: string): void {
  const setter = Object.getOwnPropertyDescriptor(Object.getPrototypeOf(el), "value")?.set;
  if (setter) setter.call(el, value);
  else el.value = value;
}

async function typeInto(el: HTMLInputElement | HTMLTextAreaElement, value: string, delay: number): Promise<void> {
  el.focus();
  if (delay <= 0 || INSTANT_TYPES.has((el as HTMLInputElement).type)) {
    setNativeValue(el, value);
    el.dispatchEvent(new Event("input", { bubbles: true }));
  } else {
    for (let i = 1; i <= value.length; i++) {
      setNativeValue(el, value.slice(0, i));
      el.dispatchEvent(new Event("input", { bubbles: true }));
      await sleep(delay);
    }
  }
  el.dispatchEvent(new Event("change", { bubbles: true }));
}

function selectOption(el: HTMLSelectElement, label: string): void {
  const option = Array.from(el.options).find((o) => o.label === label || o.text === label || o.value === label);
  if (!option) return;
  el.value = option.value;
  el.dispatchEvent(new Event("input", { bubbles: true }));
  el.dispatchEvent(new Event("change", { bubbles: true }));
}

/** Presses and releases the pointer before clicking, as a real click (and Playwright in verification) does. */
function press(el: HTMLElement): void {
  const base = { bubbles: true, cancelable: true, composed: true, button: 0 };
  const pointer = { ...base, pointerId: 1, pointerType: "mouse", isPrimary: true };
  const hasPointer = typeof PointerEvent === "function";
  if (hasPointer) el.dispatchEvent(new PointerEvent("pointerdown", { ...pointer, buttons: 1 }));
  if (el.dispatchEvent(new MouseEvent("mousedown", { ...base, buttons: 1 }))) el.focus?.({ preventScroll: true });
  if (hasPointer) el.dispatchEvent(new PointerEvent("pointerup", { ...pointer, buttons: 0 }));
  el.dispatchEvent(new MouseEvent("mouseup", { ...base, buttons: 0 }));
  el.click();
}

export async function performStepAction(
  el: Element | null,
  action: Action,
  o: { navigate?: (url: string) => void | Promise<void>; typeDelay: number },
): Promise<void> {
  if (action.type === "navigate") {
    if (o.navigate) await o.navigate(action.url);
    else location.assign(action.url);
    return;
  }
  if (!el) return;
  if (action.type === "click") press(el as HTMLElement);
  else if (action.type === "type") await typeInto(el as HTMLInputElement, action.value, o.typeDelay);
  else selectOption(el as HTMLSelectElement, action.value);
}
