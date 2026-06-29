/**
 * Cookie-injectie voor sessie-hergebruik. Zet door de companion aangeleverde
 * naam/waarde-paren als cookies voor een gegeven URL via de chrome.cookies API.
 * Cookies zonder geldige naam worden stil overgeslagen.
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
