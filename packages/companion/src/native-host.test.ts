import { describe, it, expect } from "vitest";
import { PassThrough } from "node:stream";
import { NativeHost, frame } from "./native-host.js";
import { createHandshakeHandler } from "./handshake.js";
import { handMessage, isEnvelope, PROTOCOL_VERSION, type BrainMessage } from "@yad/shared";

const INFO = { companionVersion: "9.9.9", tenantId: "t1", sessionId: "s1" };

async function waitForFirst(arr: unknown[], timeoutMs = 1000): Promise<unknown> {
  const start = Date.now();
  while (arr.length === 0) {
    if (Date.now() - start > timeoutMs) throw new Error("timeout wachtend op bericht");
    await new Promise((r) => setTimeout(r, 5));
  }
  return arr[0];
}

describe("handshake (puur, zonder streams)", () => {
  it("HELLO -> HELLO_ACK met correlationId en versie", () => {
    const sent: BrainMessage[] = [];
    const handle = createHandshakeHandler(INFO, (m) => sent.push(m));
    const hello = handMessage("HELLO", {
      extId: "abc",
      clientVersion: "0.1.0",
      capabilities: ["dom", "cdp"],
    });
    handle(hello);

    expect(sent).toHaveLength(1);
    const ack = sent[0]!;
    expect(ack.type).toBe("HELLO_ACK");
    expect(ack.correlationId).toBe(hello.id);
    if (ack.type === "HELLO_ACK") {
      expect(ack.payload.protocolVersion).toBe(PROTOCOL_VERSION);
      expect(ack.payload.companionVersion).toBe("9.9.9");
      expect(ack.payload.tenantId).toBe("t1");
    }
  });

  it("PING voor HELLO -> ERROR NO_HELLO", () => {
    const sent: BrainMessage[] = [];
    const handle = createHandshakeHandler(INFO, (m) => sent.push(m));
    handle(handMessage("PING", { t: 123 }));
    expect(sent[0]!.type).toBe("ERROR");
    if (sent[0]!.type === "ERROR") expect(sent[0]!.payload.code).toBe("NO_HELLO");
  });

  it("PING na HELLO -> PONG met zelfde t", () => {
    const sent: BrainMessage[] = [];
    const handle = createHandshakeHandler(INFO, (m) => sent.push(m));
    handle(handMessage("HELLO", { extId: "abc", clientVersion: "0.1.0", capabilities: [] }));
    handle(handMessage("PING", { t: 42 }));
    const pong = sent[1]!;
    expect(pong.type).toBe("PONG");
    if (pong.type === "PONG") expect(pong.payload.t).toBe(42);
  });

  it("niet-envelope -> ERROR BAD_ENVELOPE", () => {
    const sent: BrainMessage[] = [];
    const handle = createHandshakeHandler(INFO, (m) => sent.push(m));
    handle({ foo: 1 });
    expect(sent[0]!.type).toBe("ERROR");
    if (sent[0]!.type === "ERROR") expect(sent[0]!.payload.code).toBe("BAD_ENVELOPE");
  });

  it("verkeerde protocol-versie -> ERROR VERSION_MISMATCH", () => {
    const sent: BrainMessage[] = [];
    const handle = createHandshakeHandler(INFO, (m) => sent.push(m));
    handle({ v: 999, id: "x", type: "HELLO", payload: {} });
    expect(sent[0]!.type).toBe("ERROR");
    if (sent[0]!.type === "ERROR") expect(sent[0]!.payload.code).toBe("VERSION_MISMATCH");
  });

  it("HELLO zonder extId -> ERROR BAD_PAYLOAD", () => {
    const sent: BrainMessage[] = [];
    const handle = createHandshakeHandler(INFO, (m) => sent.push(m));
    handle({ v: PROTOCOL_VERSION, id: "x", type: "HELLO", payload: { clientVersion: "1" } });
    expect(sent[0]!.type).toBe("ERROR");
    if (sent[0]!.type === "ERROR") expect(sent[0]!.payload.code).toBe("BAD_PAYLOAD");
  });
});

describe("framing round-trip (Chrome nagebootst via streams)", () => {
  it("geframede HELLO erin -> geframede HELLO_ACK eruit", async () => {
    const fromChrome = new PassThrough();
    const toChrome = new PassThrough();
    const received: unknown[] = [];

    let host!: NativeHost;
    const handle = createHandshakeHandler(INFO, (m) => host.send(m));
    host = new NativeHost(fromChrome, toChrome, handle);
    // tweede host als decoder voor de uitgaande stream (hergebruik van de framing-parser)
    new NativeHost(toChrome, new PassThrough(), (m) => received.push(m));

    const hello = handMessage("HELLO", { extId: "abc", clientVersion: "0.1.0", capabilities: [] });
    fromChrome.write(frame(hello));

    const msg = await waitForFirst(received);
    expect(isEnvelope(msg)).toBe(true);
    const env = msg as { type: string; correlationId?: string };
    expect(env.type).toBe("HELLO_ACK");
    expect(env.correlationId).toBe(hello.id);
  });

  it("twee berichten in één chunk worden allebei verwerkt", async () => {
    const fromChrome = new PassThrough();
    const toChrome = new PassThrough();
    const received: unknown[] = [];

    let host!: NativeHost;
    const handle = createHandshakeHandler(INFO, (m) => host.send(m));
    host = new NativeHost(fromChrome, toChrome, handle);
    new NativeHost(toChrome, new PassThrough(), (m) => received.push(m));

    const hello = handMessage("HELLO", { extId: "abc", clientVersion: "0.1.0", capabilities: [] });
    const ping = handMessage("PING", { t: 7 });
    fromChrome.write(Buffer.concat([frame(hello), frame(ping)]));

    const start = Date.now();
    while (received.length < 2) {
      if (Date.now() - start > 1000) throw new Error("timeout: minder dan 2 antwoorden");
      await new Promise((r) => setTimeout(r, 5));
    }
    const types = received.map((m) => (m as { type: string }).type);
    expect(types).toContain("HELLO_ACK");
    expect(types).toContain("PONG");
  });
});

describe("veiligheidsdam", () => {
  it("absurde lengte-prefix -> onError, geen crash", async () => {
    const fromChrome = new PassThrough();
    let errored = false;
    new NativeHost(fromChrome, new PassThrough(), () => {}, () => {
      errored = true;
    });
    const header = Buffer.alloc(4);
    header.writeUInt32LE(0xffffffff, 0); // ~4 GB, ver boven de dam
    fromChrome.write(header);
    await new Promise((r) => setTimeout(r, 20));
    expect(errored).toBe(true);
  });
});
