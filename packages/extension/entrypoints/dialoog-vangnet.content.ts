/**
 * Dialoog-vangnet: zorgt dat een JavaScript-dialoogvenster de tab nooit bevriest.
 *
 * WAAROM DIT ER IS
 * Een `confirm()` blokkeert de hele renderer. Alles staat dan stil: het content-script
 * antwoordt niet meer, CDP-aanroepen komen niet meer terug, en de statusmeter zag lange
 * tijd alleen dat de verbinding nog openstond en meldde dus vrolijk "connected". Voor
 * iets dat verhuurd wordt is dat het gevaarlijkste soort defect, want de klant ziet
 * groen terwijl er niets gebeurt. Elke site met een "weet je het zeker?" legde YAD plat.
 *
 * WAAROM NIET VIA DE DEBUGGER
 * De eerste aanpak ving `Page.javascriptDialogOpening` via chrome.debugger. Dat werkte
 * alleen als de debugger toevallig al gekoppeld was, want die koppeling gebeurt pas bij
 * een CDP-commando. Mijn handmatige test slaagde puur omdat er vlak daarvoor een
 * evaluate was gedaan; de benchmark viel er meteen over met TAB BEVROREN. Een reparatie
 * die afhangt van iets ongerelateerds is geen reparatie. Bovendien toont de debugger een
 * balk aan de gebruiker en kan er maar één tegelijk gekoppeld zijn.
 *
 * Dit vangnet vervangt de drie functies in de pagina zelf. Geen permissie nodig, geen
 * balk, werkt in elk frame, en het venster verschijnt niet eens.
 *
 * DE KEUZE DIE HET MAAKT
 * `alert` heeft alleen een OK-knop, dus daar valt niets te kiezen. `confirm` en `prompt`
 * worden geANNULEERD: annuleren is de niet-destructieve keuze, en een "verwijder alles?"
 * automatisch bevestigen is precies wat je niet wilt. Een taak die wél moet bevestigen
 * zet de stand om via het `__yadDialoogStand`-venster hieronder.
 *
 * Alles wat langskomt wordt onthouden op `window.__yadDialogen`, zodat het brein achteraf
 * kan zien dát er een venster was en wat erin stond. Stil wegklikken zou dezelfde blinde
 * vlek maken als het probleem dat we oplossen.
 *
 * LET OP: dit draait in de MAIN world en op document_start. Het moet vóór de scripts van
 * de pagina staan, anders heeft een site die bij het laden meteen confirm() aanroept de
 * boel al bevroren voordat wij bestaan.
 */
export default defineContentScript({
  matches: ["<all_urls>"],
  allFrames: true,
  runAt: "document_start",
  world: "MAIN",
  main() {
    const w = window as Window & {
      __yadDialoogVangnet?: boolean;
      __yadDialoogStand?: "veilig" | "altijd-ok" | "altijd-annuleren";
      __yadDialogen?: Array<{ type: string; bericht: string; geaccepteerd: boolean; op: number }>;
    };
    if (w.__yadDialoogVangnet) return;
    w.__yadDialoogVangnet = true;
    w.__yadDialoogStand ??= "veilig";
    w.__yadDialogen ??= [];

    const noteer = (type: string, bericht: string, geaccepteerd: boolean): void => {
      w.__yadDialogen!.push({ type, bericht: String(bericht ?? "").slice(0, 300), geaccepteerd, op: Date.now() });
      // Klein houden: dit leeft in de pagina en mag niet ongelimiteerd groeien.
      if (w.__yadDialogen!.length > 20) w.__yadDialogen!.shift();
    };

    const accepteert = (type: string): boolean => {
      if (w.__yadDialoogStand === "altijd-ok") return true;
      if (w.__yadDialoogStand === "altijd-annuleren") return false;
      return type === "alert"; // veilige stand: alleen alert, die heeft geen alternatief
    };

    window.alert = function (bericht?: unknown): void {
      noteer("alert", String(bericht ?? ""), true);
    };

    window.confirm = function (bericht?: unknown): boolean {
      const ja = accepteert("confirm");
      noteer("confirm", String(bericht ?? ""), ja);
      return ja;
    };

    window.prompt = function (bericht?: unknown, standaard?: unknown): string | null {
      const ja = accepteert("prompt");
      noteer("prompt", String(bericht ?? ""), ja);
      // Bij accepteren de aangeboden standaardwaarde teruggeven; dat is wat een mens
      // doet die op OK drukt zonder iets te typen.
      return ja ? String(standaard ?? "") : null;
    };
  },
});
