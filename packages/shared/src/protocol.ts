/**
 * Native-messaging protocol tussen de Hand (extensie) en het Brein (companion).
 *
 * Transport: Chrome native messaging = stdio met een 4-byte little-endian
 * length-prefix per JSON-bericht (max 1 MB inkomend richting host). De framing
 * zelf zit in de companion (`native-host.ts`); dit bestand definieert alleen de
 * berichten-vormen die over die draad gaan.
 */

export const PROTOCOL_VERSION = 1 as const;

/** Wat de Hand kan; het Brein kiest acties op basis hiervan. */
export type Capability = "dom" | "cdp" | "ax-snapshot" | "session-capture";

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

/** Berichten van de Hand naar het Brein. */
export interface HandPayloads {
  HELLO: { extId: string; clientVersion: string; capabilities: Capability[] };
  PING: { t: number };
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
