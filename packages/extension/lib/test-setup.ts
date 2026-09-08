// jsdom heeft geen echte layout-engine: geen scrollIntoView, geen CSS.escape, en
// getBoundingClientRect geeft altijd een lege rect terug. Perception/executor-code
// leunt op al deze API's, dus zonder deze stubs faalt elke test op omgevingsgaten
// in plaats van op echte logicafouten.
Element.prototype.scrollIntoView = Element.prototype.scrollIntoView ?? ((): void => {});
document.elementFromPoint = document.elementFromPoint ?? ((): Element | null => null);
if (typeof CSS === "undefined" || !CSS.escape) {
  (globalThis as { CSS?: { escape: (s: string) => string } }).CSS = { escape: (s: string) => s };
}

// jsdom kent geen .innerText (geen layout-engine om "zichtbare" tekst uit af te leiden),
// dus zonder deze stub is elke test die op innerText leunt (de hele-pagina-extract in
// executor.ts, en de snapshot-tekstdigest in perception.ts) altijd stil aan het testen
// tegen een lege string, ongeacht de echte body-inhoud. Textcontent is geen perfecte
// vervanger (geen CSS-zichtbaarheid, geen <br>-naar-newline), maar dicht genoeg om
// logicafouten (leeg vs. niet-leeg) echt te kunnen vangen.
if (!Object.getOwnPropertyDescriptor(HTMLElement.prototype, "innerText")) {
  Object.defineProperty(HTMLElement.prototype, "innerText", {
    configurable: true,
    get(this: HTMLElement): string {
      return this.textContent ?? "";
    },
    set(this: HTMLElement, value: string): void {
      this.textContent = value;
    },
  });
}
