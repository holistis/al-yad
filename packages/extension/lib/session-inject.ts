/**
 * Sessie-injectie helpers voor hergebruik van opgeslagen sessies.
 *
 * injectCookies  — cookies via de chrome.cookies API (werkt op elke URL)
 * injectLocalStorage — localStorage via executeScript in een specifieke tab
 *                      (vereist dat de tab op de juiste origin staat)
 */

interface CookieSpec {
  name: string;
  value: string;
}

/**
 * Injecteer cookies in de browser voor de gegeven URL.
 * Geeft het aantal succesvol gezette cookies terug.
 */
export async function injectCookies(url: string, cookies: CookieSpec[]): Promise<number> {
  let count = 0;
  for (const { name, value } of cookies) {
    if (!name.trim()) continue;
    try {
      await chrome.cookies.set({ url, name, value });
      count++;
    } catch {
      // Kan falen door SameSite-restrictie of ongeldige URL; overslaan.
    }
  }
  return count;
}

/**
 * Injecteer localStorage-items in een specifieke tab via executeScript.
 * Werkt alleen als de tab al op de juiste origin staat (cross-origin blocks).
 * Geeft het aantal succesvol gezette items terug.
 */
export async function injectLocalStorage(tabId: number, items: Record<string, string>): Promise<number> {
  let count = 0;
  for (const [key, value] of Object.entries(items)) {
    try {
      await chrome.scripting.executeScript({
        target: { tabId },
        func: (k: string, v: string) => { localStorage.setItem(k, v); },
        args: [key, value],
        world: "MAIN",
      });
      count++;
    } catch {
      // Tab staat op verkeerde origin of scripting is niet toegestaan → overslaan.
    }
  }
  return count;
}
