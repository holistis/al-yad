import {
  brainMessage,
  isEnvelope,
  PROTOCOL_VERSION,
  type BrainMessage,
  type Capability,
} from "@yad/shared";

export interface CompanionInfo {
  companionVersion: string;
  tenantId: string;
  sessionId: string;
}

export type SendFn = (msg: BrainMessage) => void;
export type LogFn = (msg: string) => void;

/**
 * Bouwt de handshake-handler. Behandelt binnenkomende berichten van de Hand als
 * VIJANDIGE input (Data-check): alles wordt gevalideerd, nooit blind gecast.
 *
 * HELLO  -> HELLO_ACK (met versie-check)
 * PING   -> PONG (alleen na een geldige HELLO)
 * anders -> ERROR
 */
export function createHandshakeHandler(
  info: CompanionInfo,
  send: SendFn,
  log: LogFn = () => {},
): (raw: unknown) => void {
  let helloReceived = false;

  return function handle(raw: unknown): void {
    if (!isEnvelope(raw)) {
      send(
        brainMessage("ERROR", {
          code: "BAD_ENVELOPE",
          message: "Bericht is geen geldige envelope",
        }),
      );
      return;
    }

    if (raw.v !== PROTOCOL_VERSION) {
      send(
        brainMessage(
          "ERROR",
          {
            code: "VERSION_MISMATCH",
            message: `Verwacht protocol v${PROTOCOL_VERSION}, kreeg v${String(raw.v)}`,
          },
          raw.id,
        ),
      );
      return;
    }

    switch (raw.type) {
      case "HELLO": {
        const p = raw.payload as Partial<{
          extId: string;
          clientVersion: string;
          capabilities: Capability[];
        }>;
        if (typeof p?.extId !== "string" || typeof p?.clientVersion !== "string") {
          send(
            brainMessage(
              "ERROR",
              { code: "BAD_PAYLOAD", message: "HELLO mist extId of clientVersion" },
              raw.id,
            ),
          );
          return;
        }
        const caps = Array.isArray(p.capabilities) ? p.capabilities : [];
        helloReceived = true;
        log(
          `HELLO van ext ${p.extId} (client ${p.clientVersion}), caps=[${caps.join(",")}]`,
        );
        send(
          brainMessage(
            "HELLO_ACK",
            {
              companionVersion: info.companionVersion,
              protocolVersion: PROTOCOL_VERSION,
              tenantId: info.tenantId,
              sessionId: info.sessionId,
            },
            raw.id,
          ),
        );
        return;
      }

      case "PING": {
        if (!helloReceived) {
          send(
            brainMessage(
              "ERROR",
              { code: "NO_HELLO", message: "PING ontvangen voor HELLO" },
              raw.id,
            ),
          );
          return;
        }
        const p = raw.payload as Partial<{ t: number }>;
        const t = typeof p?.t === "number" ? p.t : 0;
        send(brainMessage("PONG", { t }, raw.id));
        return;
      }

      default: {
        send(
          brainMessage(
            "ERROR",
            { code: "UNKNOWN_TYPE", message: `Onbekend berichttype: ${raw.type}` },
            raw.id,
          ),
        );
        return;
      }
    }
  };
}
