import type { Strategy } from "./guide.js";
import type { ElementFacts } from "./safety.js";

export interface ObservedElement {
  id: string;
  role: string;
  name: string;
  tag: string;
  type?: string;
  label?: string;
  placeholder?: string;
  text?: string;
  tour?: string;
  testid?: string;
  options?: string[];
  disabled: boolean;
  inForm: boolean;
  box: { x: number; y: number; w: number; h: number };
}

export interface Observation {
  url: string;
  title: string;
  elements: ObservedElement[];
  truncated: boolean;
}

export interface ExplicameRuntime {
  observe(max?: number): Observation;
  byId(id: string): Element | null;
  uniqueStrategies(el: Element): Strategy[];
  candidateStrategies(el: Element): Strategy[];
  resolve(strategies: Strategy[]): Element | null;
  matchAll(strategy: Strategy): Element[];
  describe(el: Element): ElementFacts;
  roleOf(el: Element): string;
  nameOf(el: Element): string;
  labelOf(el: Element): string;
  cssPath(el: Element): string;
}

declare global {
  interface Window {
    __explicame?: ExplicameRuntime;
    __explicameNoLayout?: boolean;
  }
}

/**
 * Plain JavaScript installed in the page (Playwright addInitScript, or evaluated by the player).
 * Keep it dependency-free and ES5-style: it is a string, not a module.
 */
export const DOM_RUNTIME = String.raw`(function () {
  if (window.__explicame) return;
  var MARK = "data-explicame-id";
  var INTERACTIVE = 'button, a[href], input:not([type="hidden"]), select, textarea, summary, [contenteditable="true"], [contenteditable=""], [role="button"], [role="link"], [role="tab"], [role="menuitem"], [role="checkbox"], [role="radio"], [role="switch"], [role="combobox"], [role="option"], [role="textbox"], [role="slider"]';
  var LANDMARKS = 'h1, h2, h3, [role="dialog"], dialog[open], [role="alert"], [role="status"]';
  var ROLES = ["button", "link", "textbox", "searchbox", "combobox", "listbox", "checkbox", "radio", "switch", "tab", "menuitem", "option", "slider", "heading", "dialog"];
  var esc = window.CSS && window.CSS.escape ? function (s) { return window.CSS.escape(s); } : function (s) { return String(s).replace(/[^a-zA-Z0-9_-]/g, function (c) { return "\\" + c; }); };

  function clean(s, max) { s = String(s == null ? "" : s).replace(/\s+/g, " ").trim(); return max && s.length > max ? s.slice(0, max) : s; }
  function quote(s) { return String(s).replace(/\\/g, "\\\\").replace(/"/g, '\\"'); }

  function roleOf(el) {
    var explicit = el.getAttribute("role");
    if (explicit) return explicit.split(" ")[0];
    var tag = el.tagName.toLowerCase();
    if (tag === "button" || tag === "summary") return "button";
    if (tag === "a" && el.hasAttribute("href")) return "link";
    if (tag === "select") return el.multiple || el.size > 1 ? "listbox" : "combobox";
    if (tag === "textarea") return "textbox";
    if (tag === "dialog") return "dialog";
    if (/^h[1-6]$/.test(tag)) return "heading";
    if (tag === "input") {
      var type = (el.getAttribute("type") || "text").toLowerCase();
      if (["button", "submit", "reset", "image"].indexOf(type) >= 0) return "button";
      if (type === "checkbox") return "checkbox";
      if (type === "radio") return "radio";
      if (type === "range") return "slider";
      if (type === "search") return "searchbox";
      return "textbox";
    }
    if (el.isContentEditable) return "textbox";
    return tag;
  }

  function textWithoutControls(node) {
    var copy = node.cloneNode(true);
    Array.prototype.forEach.call(copy.querySelectorAll("input, select, textarea, button"), function (n) { n.parentNode.removeChild(n); });
    return clean(copy.textContent, 200);
  }

  function labelOf(el) {
    var by = el.getAttribute("aria-labelledby");
    if (by) return clean(by.split(/\s+/).map(function (id) { var n = document.getElementById(id); return n ? n.textContent : ""; }).join(" "), 200);
    if (el.id) { var forLabel = document.querySelector('label[for="' + quote(el.id) + '"]'); if (forLabel) return textWithoutControls(forLabel); }
    var wrap = el.closest("label");
    return wrap ? textWithoutControls(wrap) : "";
  }

  function nameOf(el) {
    var aria = el.getAttribute("aria-label");
    if (aria && aria.trim()) return clean(aria, 200);
    var label = labelOf(el);
    if (label) return label;
    var tag = el.tagName.toLowerCase();
    if (tag === "input") {
      var type = (el.getAttribute("type") || "text").toLowerCase();
      if (["button", "submit", "reset"].indexOf(type) >= 0) return clean(el.value || (type === "submit" ? "Submit" : ""), 200);
      if (type === "image") return clean(el.getAttribute("alt"), 200);
      return clean(el.getAttribute("placeholder") || el.getAttribute("title"), 200);
    }
    if (tag === "textarea" || tag === "select") return clean(el.getAttribute("title") || el.getAttribute("placeholder"), 200);
    var text = clean(typeof el.innerText === "string" && el.innerText !== "" ? el.innerText : el.textContent, 200);
    if (text) return text;
    var img = el.querySelector("img[alt]");
    return img ? clean(img.getAttribute("alt"), 200) : clean(el.getAttribute("title"), 200);
  }

  function isVisible(el) {
    if (!el.isConnected || el.closest("[hidden]") || el.closest("dialog:not([open])")) return false;
    var style = window.getComputedStyle(el);
    if (style.display === "none" || style.visibility === "hidden") return false;
    if (window.__explicameNoLayout) return true;
    var rect = el.getBoundingClientRect();
    return rect.width > 0 && rect.height > 0;
  }

  function stableId(node) {
    var id = node.id;
    return !!id && /^[A-Za-z][\w-]*$/.test(id) && !/\d{3,}/.test(id) && document.querySelectorAll("#" + esc(id)).length === 1;
  }

  function cssPath(el) {
    var parts = [];
    var node = el;
    while (node && node.nodeType === 1) {
      if (stableId(node)) { parts.unshift("#" + esc(node.id)); break; }
      if (node === document.body) { parts.unshift("body"); break; }
      var parent = node.parentElement;
      var selector = node.tagName.toLowerCase();
      if (parent) {
        var current = node;
        var same = Array.prototype.filter.call(parent.children, function (c) { return c.tagName === current.tagName; });
        if (same.length > 1) selector += ":nth-of-type(" + (same.indexOf(current) + 1) + ")";
      }
      parts.unshift(selector);
      node = parent;
    }
    return parts.join(" > ");
  }

  function ownText(el) { return clean(el.textContent, 200); }
  function all(selector) { return Array.prototype.slice.call(document.querySelectorAll(selector)); }

  function matchAll(s) {
    try {
      if (s.by === "tour") return all('[data-tour="' + quote(s.value) + '"]').filter(isVisible);
      if (s.by === "testid") return all('[data-testid="' + quote(s.value) + '"]').filter(isVisible);
      if (s.by === "css") return all(s.value).filter(isVisible);
      if (s.by === "role") return all("*").filter(function (el) { return roleOf(el) === s.role && nameOf(el) === s.name; }).filter(isVisible);
      if (s.by === "label") return all("input, select, textarea").filter(function (el) { return labelOf(el) === s.value; }).filter(isVisible);
      if (s.by === "text") return all("body *").filter(function (el) {
        return ownText(el) === s.value && !Array.prototype.some.call(el.children, function (c) { return ownText(c) === s.value; });
      }).filter(isVisible);
    } catch (e) { return []; }
    return [];
  }

  function candidateStrategies(el) {
    var out = [];
    var tour = el.getAttribute("data-tour"); if (tour) out.push({ by: "tour", value: tour });
    var testid = el.getAttribute("data-testid"); if (testid) out.push({ by: "testid", value: testid });
    var role = roleOf(el); var name = nameOf(el);
    if (ROLES.indexOf(role) >= 0 && name && name.length <= 80) out.push({ by: "role", role: role, name: name });
    var label = labelOf(el); if (label && label.length <= 80) out.push({ by: "label", value: label });
    var text = ownText(el);
    if (text && text.length <= 40 && ["input", "select", "textarea"].indexOf(el.tagName.toLowerCase()) < 0) out.push({ by: "text", value: text });
    out.push({ by: "css", value: cssPath(el) });
    return out;
  }

  function uniqueStrategies(el) {
    return candidateStrategies(el).filter(function (s) { var m = matchAll(s); return m.length === 1 && m[0] === el; }).slice(0, 6);
  }

  function resolve(strategies) {
    for (var i = 0; i < strategies.length; i++) { var m = matchAll(strategies[i]); if (m.length === 1) return m[0]; }
    return null;
  }

  function describe(el) {
    var facts = { tag: el.tagName.toLowerCase(), role: roleOf(el), name: nameOf(el), inForm: !!el.closest("form") };
    if (el.type) facts.type = String(el.type).toLowerCase();
    return { tag: facts.tag, type: facts.type, role: facts.role, name: facts.name, inForm: facts.inForm };
  }

  function observe(max) {
    max = max || 150;
    all("[" + MARK + "]").forEach(function (n) { n.removeAttribute(MARK); });
    var visible = all(INTERACTIVE + ", " + LANDMARKS).filter(isVisible);
    var height = window.innerHeight || 800;
    var inView = []; var rest = [];
    visible.forEach(function (el) { var r = el.getBoundingClientRect(); (r.bottom >= 0 && r.top <= height ? inView : rest).push(el); });
    var picked = inView.concat(rest).slice(0, max);
    picked.sort(function (a, b) { return a.compareDocumentPosition(b) & Node.DOCUMENT_POSITION_FOLLOWING ? -1 : 1; });
    var elements = picked.map(function (el, i) {
      var id = "e" + (i + 1);
      el.setAttribute(MARK, id);
      var r = el.getBoundingClientRect();
      var item = { id: id, role: roleOf(el), name: nameOf(el), tag: el.tagName.toLowerCase(), disabled: !!el.disabled || el.getAttribute("aria-disabled") === "true", inForm: !!el.closest("form"), box: { x: Math.round(r.x), y: Math.round(r.y), w: Math.round(r.width), h: Math.round(r.height) } };
      if (el.type) item.type = String(el.type).toLowerCase();
      var label = labelOf(el); if (label) item.label = label;
      var placeholder = el.getAttribute("placeholder"); if (placeholder) item.placeholder = clean(placeholder, 80);
      var text = ownText(el); if (text && text !== item.name) item.text = clean(text, 80);
      var tour = el.getAttribute("data-tour"); if (tour) item.tour = tour;
      var testid = el.getAttribute("data-testid"); if (testid) item.testid = testid;
      if (el.tagName === "SELECT") item.options = Array.prototype.map.call(el.options, function (o) { return clean(o.label || o.text, 40); }).slice(0, 20);
      return item;
    });
    return { url: location.pathname + location.search, title: document.title, elements: elements, truncated: visible.length > picked.length };
  }

  function byId(id) { return document.querySelector("[" + MARK + '="' + quote(id) + '"]'); }

  window.__explicame = { observe: observe, byId: byId, uniqueStrategies: uniqueStrategies, candidateStrategies: candidateStrategies, resolve: resolve, matchAll: matchAll, describe: describe, roleOf: roleOf, nameOf: nameOf, labelOf: labelOf, cssPath: cssPath };
})();`;
