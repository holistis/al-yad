// jsdom heeft geen echte layout-engine: geen scrollIntoView, geen CSS.escape, en
// getBoundingClientRect geeft altijd een lege rect terug. Perception/executor-code
// leunt op al deze API's, dus zonder deze stubs faalt elke test op omgevingsgaten
// in plaats van op echte logicafouten.
Element.prototype.scrollIntoView = Element.prototype.scrollIntoView ?? ((): void => {});
document.elementFromPoint = document.elementFromPoint ?? ((): Element | null => null);
if (typeof CSS === "undefined" || !CSS.escape) {
  (globalThis as { CSS?: { escape: (s: string) => string } }).CSS = { escape: (s: string) => s };
}
