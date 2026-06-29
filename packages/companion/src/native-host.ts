import type { Readable, Writable } from "node:stream";

/**
 * Chrome native-messaging framing: elk bericht wordt voorafgegaan door 4 bytes
 * met de lengte in little-endian, daarna UTF-8 JSON. Chrome stuurt max 1 MB
 * richting de host. We hanteren een ruime bovengrens als veiligheidsdam
 * (Data-check): een misvormde lengte-prefix mag ons geen geheugen laten slurpen.
 */
export const MAX_MESSAGE_BYTES = 64 * 1024 * 1024; // 64 MB harde dam

export type MessageHandler = (message: unknown) => void;
export type HostErrorHandler = (error: Error) => void;

/**
 * Leest/schrijft length-prefixed JSON-berichten over twee streams.
 * In productie zijn dat process.stdin/stdout; in tests PassThrough-streams,
 * zodat we Chrome volledig kunnen nabootsen zonder browser.
 */
export class NativeHost {
  private buffer: Buffer = Buffer.alloc(0);
  private closed = false;

  constructor(
    private readonly input: Readable,
    private readonly output: Writable,
    private readonly onMessage: MessageHandler,
    private readonly onError: HostErrorHandler = () => {},
  ) {
    this.input.on("data", (chunk: Buffer) => this.onData(chunk));
    this.input.on("end", () => {
      this.closed = true;
    });
  }

  private onData(chunk: Buffer): void {
    if (this.closed) return;
    this.buffer = Buffer.concat([this.buffer, chunk]);

    // Verwerk zoveel volledige berichten als al binnen zijn.
    for (;;) {
      if (this.buffer.length < 4) return;
      const length = this.buffer.readUInt32LE(0);

      if (length > MAX_MESSAGE_BYTES) {
        this.closed = true;
        this.onError(
          new Error(
            `Bericht-lengte ${length} overschrijdt de dam van ${MAX_MESSAGE_BYTES} bytes`,
          ),
        );
        return;
      }

      if (this.buffer.length < 4 + length) return; // nog niet compleet

      const body = this.buffer.subarray(4, 4 + length);
      this.buffer = this.buffer.subarray(4 + length);

      let parsed: unknown;
      try {
        parsed = JSON.parse(body.toString("utf8"));
      } catch (err) {
        this.onError(err instanceof Error ? err : new Error(String(err)));
        continue;
      }
      this.onMessage(parsed);
    }
  }

  /** Schrijft een bericht met length-prefix terug richting de andere kant. */
  send(message: unknown): void {
    if (this.closed) return;
    const json = Buffer.from(JSON.stringify(message), "utf8");
    const header = Buffer.alloc(4);
    header.writeUInt32LE(json.length, 0);
    try {
      this.output.write(header);
      this.output.write(json);
    } catch (err) {
      // EPIPE of andere schrijffout: Chrome heeft de pipe dichtgegooid.
      // Niet crashen; markeer als gesloten zodat volgende send() direct returnt.
      this.closed = true;
      this.onError(err instanceof Error ? err : new Error(String(err)));
    }
  }
}

/** Helper: verpak een object als één native-messaging frame (4-byte LE + JSON). */
export function frame(message: unknown): Buffer {
  const json = Buffer.from(JSON.stringify(message), "utf8");
  const header = Buffer.alloc(4);
  header.writeUInt32LE(json.length, 0);
  return Buffer.concat([header, json]);
}
