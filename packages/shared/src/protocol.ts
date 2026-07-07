/**
 * Native-messaging protocol tussen de Hand (extensie) en het Brein (companion).
 *
 * Transport: Chrome native messaging = stdio met een 4-byte little-endian
 * length-prefix per JSON-bericht (max 1 MB inkomend richting host). De framing
 * zelf zit in de companion (`native-host.ts`); dit bestand definieert alleen de
 * berichten-vormen die over die draad gaan.
 */

import type { Action, ActResult } from "./action.js";
import type { Snapshot } from "./snapshot.js";

export const PROTOCOL_VERSION = 1 as const;

/** Wat de Hand kan; het Brein kiest acties op basis hiervan. */
export type Capability = "dom" | "cdp" | "ax-snapshot" | "session-capture";

/** Voortgangsstatus van een agent-run, getoond in de sidepanel. */
export type RunStatus =
  | "plannen"
  | "bezig"
  | "klaar"
  | "gestopt"
  | "fout"
  | "geweigerd"
  /** Loop vastzit; wacht op herstelplan van Claude Code via POST /assist. */
  | "hulp-nodig";

/** Generieke envelope. Elk bericht heeft een uniek id; antwoorden zetten `correlationId`. */
export interface Envelope<TType extends string, TPayload> {
  /** protocol-versie */
  v: number;
  /** uniek bericht-id (uuid) */
  id: string;
  /** discriminator */
  type: TType;
  /** id van het bericht waarop dit een antwoord is */
  correlationId?: string;
  payload: TPayload;
}

/** Een bijlage die de gebruiker meestuurt met een taak (afbeelding). */
export interface Attachment {
  type: "image";
  mimeType: string;
  /** Base64-gecodeerde inhoud (zonder data: prefix). */
  data: string;
  name?: string;
}

/** Berichten van de Hand naar het Brein. */
export interface HandPayloads {
  HELLO: { extId: string; clientVersion: string; capabilities: Capability[] };
  PING: { t: number };
  /** start een nieuwe agent-run (vanuit de sidepanel) */
  GOAL: { goal: string; maxSteps?: number; attachments?: Attachment[]; startingUrl?: string };
  /** antwoord op REQUEST_SNAPSHOT (correlationId verwijst naar de aanvraag) */
  SNAPSHOT_RESULT: { snapshot: Snapshot };
  /** antwoord op ACT */
  ACT_RESULT: ActResult;
  /** antwoord op REQUEST_CONFIRM */
  CONFIRM_RESULT: { approved: boolean };
  /** breek de lopende run af (bv. de run-tab is gesloten) */
  ABORT_RUN: { reason: string };
  /** live configuratie-update vanuit de instellingen (sleutels, gedrag) */
  UPDATE_CONFIG: { env: Record<string, string>; maxSteps?: number; autonomy?: "confirm" | "auto"; language?: "nl" | "en" };
  /** vastgelegde sessie van de actieve tab (cookies + localStorage) voor de REDACTED-adapter */
  SESSION_CAPTURE: {
    url: string;
    cookieHeader: string;
    localStorage: Record<string, string>;
    label: "A" | "B";
  };
  /** antwoord op REQUEST_SESSION_CAPTURE: ruwe sessie-data voor opslaan in REDACTED */
  SESSION_CAPTURE_DATA: {
    ok: boolean;
    label: "A" | "B";
    url?: string;
    cookieHeader?: string;
    localStorage?: Record<string, string>;
    detail?: string;
  };
  /** pagina-capture voor Claude Code — stuurt URL + titel + tekst + links naar companion die het naar schijf schrijft */
  PAGE_CAPTURE: {
    url: string;
    title: string;
    text: string;
    capturedAt: string;
    links?: Array<{ href: string; text: string }>;
  };
  /** antwoord op INJECT_COOKIES (correlationId verwijst naar de aanvraag) */
  INJECT_COOKIES_RESULT: { ok: boolean; count: number };
  /** antwoord op INJECT_LOCALSTORAGE (correlationId verwijst naar de aanvraag) */
  INJECT_LOCALSTORAGE_RESULT: { ok: boolean; count: number };
  /** antwoord op REQUEST_NAVIGATE */
  NAVIGATE_RESULT: { ok: boolean; detail?: string };
  /** antwoord op REQUEST_SCREENSHOT: base64-PNG van de zichtbare tab */
  SCREENSHOT_RESULT: { ok: boolean; dataUrl?: string; detail?: string };
  /** antwoord op CDP_COMMAND — bevat resultaat van de gevraagde CDP-operatie */
  CDP_RESULT: {
    ok: boolean;
    command: string;
    detail?: string;
    /** gevangen netwerkverzoeken (bij stop_capture) */
    requests?: CdpNetworkEntry[];
    /** geëvalueerde waarde (bij evaluate) */
    value?: string;
    valueType?: string;
    /** response-body (bij get_response_body) */
    body?: string;
    base64Encoded?: boolean;
  };
}

/** Eén vastgelegd netwerkverzoek inclusief response-data. */
export interface CdpNetworkEntry {
  requestId: string;
  method: string;
  url: string;
  status?: number;
  mimeType?: string;
  requestHeaders: Record<string, string>;
  requestBody?: string;
  responseHeaders?: Record<string, string>;
  responseBody?: string;
  timestamp: number;
}

/** Berichten van het Brein naar de Hand. */
export interface BrainPayloads {
  HELLO_ACK: {
    companionVersion: string;
    protocolVersion: number;
    tenantId: string;
    sessionId: string;
  };
  PONG: { t: number };
  ERROR: { code: string; message: string };
  /** vraag de Hand om een verse perceptie van de actieve pagina */
  REQUEST_SNAPSHOT: Record<string, never>;
  /** laat de Hand een actie uitvoeren */
  ACT: { action: Action };
  /** vraag de gebruiker om bevestiging voor een schrijf-/onomkeerbare actie */
  REQUEST_CONFIRM: { action: Action; reason: string };
  /** voortgang naar de sidepanel */
  RUN_UPDATE: { status: RunStatus; step?: number; message: string; action?: Action };
  /** welke providers zijn actief in de companion-pool (na (her)bouw) */
  COMPANION_CONFIG: { activeProviders: string[] };
  /** resultaat van een SESSION_CAPTURE: heeft de REDACTED-adapter de sessie opgeslagen? */
  SESSION_RESULT: {
    ok: boolean;
    brand?: string;
    path?: string;
    authType?: string;
    detail?: string;
  };
  /** resultaat van een PAGE_CAPTURE: is de brug-file geschreven? */
  CLAUDE_BRIDGE_RESULT: {
    ok: boolean;
    path?: string;
    detail?: string;
  };
  /** vraag de Hand om de actieve pagina te capturen en terug te sturen als PAGE_CAPTURE */
  REQUEST_CAPTURE_FOR_CLAUDE: Record<string, never>;
  /** vraag de Hand om de actieve tab te navigeren naar een URL en te wachten tot geladen */
  REQUEST_NAVIGATE: { url: string };
  /** vraag de Hand om een screenshot van de actieve run-tab (visuele fallback bij stuck) */
  REQUEST_SCREENSHOT: Record<string, never>;
  /** vraag de Hand om cookies te injecteren voor een URL (sessie-hergebruik) */
  INJECT_COOKIES: { url: string; cookies: Array<{ name: string; value: string }> };
  /** vraag de Hand om localStorage-items te zetten in de actieve run-tab (jwt-bearer sessie-hergebruik) */
  INJECT_LOCALSTORAGE: { items: Record<string, string> };
  /** vraag de Hand om de actieve tab te capturen en de sessie-data terug te sturen (HTTP API-pad) */
  REQUEST_SESSION_CAPTURE: { label: "A" | "B" };
  /** stuur een CDP-opdracht naar de extension (network capture, evaluate, response body) */
  CDP_COMMAND: {
    /** Welke CDP-operatie uitvoeren */
    command:
      | "start_capture"      // attach debugger + Network.enable, begin netwerkverkeer vastleggen
      | "stop_capture"       // stop vastleggen + return alle gevangen verzoeken + detach
      | "evaluate"           // Runtime.evaluate: voer JavaScript uit in de pagina-context
      | "get_response_body"; // Network.getResponseBody: haal response-body op voor een requestId
    /** Doeltab; ontbreekt = meest recente web-tab */
    tabId?: number;
    /** Vang alleen URLs die dit patroon bevatten (voor start_capture, optioneel) */
    urlFilter?: string;
    /** JavaScript-expressie (voor evaluate) */
    expression?: string;
    /** requestId van een gevangen verzoek (voor get_response_body) */
    requestId?: string;
  };
}

export type HandMessage = {
  [K in keyof HandPayloads]: Envelope<K & string, HandPayloads[K]>;
}[keyof HandPayloads];

export type BrainMessage = {
  [K in keyof BrainPayloads]: Envelope<K & string, BrainPayloads[K]>;
}[keyof BrainPayloads];

export type AnyMessage = HandMessage | BrainMessage;

/** Bouwt een getypeerd Hand-bericht met een uniek id. */
export function handMessage<K extends keyof HandPayloads>(
  type: K,
  payload: HandPayloads[K],
  correlationId?: string,
): Envelope<K & string, HandPayloads[K]> {
  return {
    v: PROTOCOL_VERSION,
    id: newId(),
    type: type as K & string,
    ...(correlationId ? { correlationId } : {}),
    payload,
  };
}

/** Bouwt een getypeerd Brein-bericht met een uniek id. */
export function brainMessage<K extends keyof BrainPayloads>(
  type: K,
  payload: BrainPayloads[K],
  correlationId?: string,
): Envelope<K & string, BrainPayloads[K]> {
  return {
    v: PROTOCOL_VERSION,
    id: newId(),
    type: type as K & string,
    ...(correlationId ? { correlationId } : {}),
    payload,
  };
}

/** uuid die in zowel Node (>=20) als de browser werkt, zonder DOM/node lib te eisen. */
export function newId(): string {
  const c = (globalThis as typeof globalThis & {
    crypto: { randomUUID(): string };
  }).crypto;
  return c.randomUUID();
}

/** Type-guard: is dit een geldig envelope-vormig object? */
export function isEnvelope(value: unknown): value is Envelope<string, unknown> {
  if (typeof value !== "object" || value === null) return false;
  const v = value as Record<string, unknown>;
  return (
    typeof v["v"] === "number" &&
    typeof v["id"] === "string" &&
    typeof v["type"] === "string" &&
    "payload" in v
  );
}
