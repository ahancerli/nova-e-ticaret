import "server-only";
import net from "node:net";
import tls from "node:tls";
import { toBase64 } from "@/core";
import type { SmtpServer, SmtpTransport } from "../application/ports";
import { classifySmtpFailure, type SmtpFailure, type SmtpStage } from "../domain/smtp-failure";

const TIMEOUT_MS = 20_000;
type Reply = { code: number; text: string };
type Sock = net.Socket | tls.TLSSocket;

class ReplyError extends Error {
  constructor(readonly r: Reply) { super(`SMTP ${r.code}`); }
}
class ClosedError extends Error {}
class NotOffered extends Error {}
const TIMED_OUT = Symbol("timeout");

/** Line reader over a (replaceable) socket: SMTP replies are CRLF lines, multi-line replies use "250-". */
class SmtpLine {
  private buf = "";
  private lines: string[] = [];
  private waiters: { res: (l: string) => void; rej: (e: Error) => void }[] = [];
  private failure: Error | null = null;
  private readonly onData = (d: Buffer) => {
    this.buf += d.toString("utf8");
    for (let i = this.buf.indexOf("\r\n"); i >= 0; i = this.buf.indexOf("\r\n")) {
      const line = this.buf.slice(0, i);
      this.buf = this.buf.slice(i + 2);
      const w = this.waiters.shift();
      if (w) w.res(line); else this.lines.push(line);
    }
  };
  private readonly onError = (e: Error) => this.fail(e);
  private readonly onClose = () => this.fail(new ClosedError("connection closed"));

  constructor(public sock: Sock) { this.attach(sock); }

  attach(s: Sock) {
    this.sock = s;
    s.on("data", this.onData).on("error", this.onError).on("close", this.onClose);
  }

  detach() {
    this.sock.off("data", this.onData).off("error", this.onError).off("close", this.onClose);
  }

  private fail(e: Error) {
    this.failure ??= e;
    for (const w of this.waiters.splice(0)) w.rej(e);
  }

  private line(): Promise<string> {
    const l = this.lines.shift();
    if (l !== undefined) return Promise.resolve(l);
    if (this.failure) return Promise.reject(this.failure);
    return new Promise((res, rej) => this.waiters.push({ res, rej }));
  }

  async reply(): Promise<Reply> {
    const parts: string[] = [];
    for (;;) {
      const l = await this.line();
      parts.push(l.slice(4));
      if (l.length < 4 || l[3] === " ") return { code: Number(l.slice(0, 3)), text: parts.join("\n") };
    }
  }

  /** Unexpected reply → ReplyError with the server's answer only (the command may carry credentials). */
  async cmd(command: string, expect: number[]): Promise<Reply> {
    this.sock.write(`${command}\r\n`);
    const r = await this.reply();
    if (!expect.includes(r.code)) throw new ReplyError(r);
    return r;
  }
}

const opened = (s: Sock, event: "connect" | "secureConnect") =>
  new Promise<void>((res, rej) => { s.once(event, () => res()); s.once("error", rej); });

async function openSocket(server: SmtpServer, onTcp?: () => void): Promise<Sock> {
  if (server.security === "ssl") {
    const s = tls.connect({ host: server.host, port: server.port, servername: server.host });
    s.once("connect", () => onTcp?.()); // TCP is up; what follows is the TLS handshake
    await opened(s, "secureConnect");
    return s;
  }
  const s = net.connect({ host: server.host, port: server.port });
  await opened(s, "connect");
  return s;
}

/** A thrown value → the facts `classifySmtpFailure` needs. */
function factsOf(err: unknown, stage: SmtpStage): SmtpFailure {
  if (err === TIMED_OUT) return { stage, timeout: true };
  if (err instanceof ReplyError) return { stage, smtpCode: err.r.code, reply: err.r.text };
  if (err instanceof NotOffered) return { stage, notOffered: true };
  if (err instanceof ClosedError) return { stage, closed: true };
  const e = err as { code?: unknown; message?: unknown };
  return { stage, sysCode: typeof e?.code === "string" ? e.code : undefined, message: String(e?.message ?? err), closed: e?.code === "ECONNRESET" || undefined };
}

/**
 * Dependency-free SMTP client over node:net / node:tls. `ssl` = TLS from the first byte (port 465), `starttls` =
 * plain then upgrade (port 587). AUTH PLAIN when offered, otherwise AUTH LOGIN. Many VPS providers block outgoing
 * port 25, so use 465 / 587.
 * Failures are classified by stage + server reply (`classifySmtpFailure`); success returns the server's accept line
 * (e.g. Gmail "250 2.0.0 OK … gsmtp") as proof the message was handed to that server.
 */
export class NodeSmtpTransport implements SmtpTransport {
  /** `connect` opens the first socket (tests pass a plain socket to a fake server); the default is the real network. */
  constructor(private readonly connect: (server: SmtpServer, onTcp?: () => void) => Promise<Sock> = openSocket, private readonly timeoutMs = TIMEOUT_MS) {}

  async send(server: SmtpServer, envelope: { from: string; to: string }, mime: string): Promise<{ serverReply: string }> {
    let sock: Sock | null = null;
    let stage: SmtpStage = "connect";
    let timer: ReturnType<typeof setTimeout> | undefined;
    const timeout = new Promise<never>((_, rej) => { timer = setTimeout(() => rej(TIMED_OUT), this.timeoutMs); });
    const run = async (): Promise<string> => {
      sock = await this.connect(server, () => { stage = "tls"; });
      const io = new SmtpLine(sock);
      stage = "greeting";
      const greet = await io.reply();
      if (greet.code !== 220) throw new ReplyError(greet);
      stage = "ehlo";
      let ehlo = await io.cmd("EHLO nova.local", [250]);

      if (server.security === "starttls") {
        stage = "starttls";
        if (!/\bSTARTTLS\b/i.test(ehlo.text)) throw new NotOffered();
        await io.cmd("STARTTLS", [220]);
        io.detach();
        stage = "tls";
        const secure = tls.connect({ socket: sock, servername: server.host });
        await opened(secure, "secureConnect");
        sock = secure;
        io.attach(secure);
        stage = "ehlo";
        ehlo = await io.cmd("EHLO nova.local", [250]);
      }

      stage = "auth";
      const b64 = (v: string) => toBase64(new TextEncoder().encode(v));
      const auth = /^AUTH[ =](.*)$/im.exec(ehlo.text)?.[1] ?? "";
      if (!auth) throw new NotOffered();
      if (/\bPLAIN\b/i.test(auth)) {
        await io.cmd(`AUTH PLAIN ${b64(`\u0000${server.username}\u0000${server.password}`)}`, [235]);
      } else {
        await io.cmd("AUTH LOGIN", [334]);
        await io.cmd(b64(server.username), [334]);
        await io.cmd(b64(server.password), [235]);
      }

      stage = "sender";
      await io.cmd(`MAIL FROM:<${envelope.from}>`, [250]);
      stage = "recipient";
      await io.cmd(`RCPT TO:<${envelope.to}>`, [250, 251]);
      stage = "data";
      await io.cmd("DATA", [354]);
      // Dot-stuffing: a line starting with "." gets another "." (RFC 5321 §4.5.2).
      const accepted = await io.cmd(`${mime.replace(/\r\n\./g, "\r\n..")}\r\n.`, [250]);
      await io.cmd("QUIT", [221]).catch(() => { /* already delivered */ });
      return `${accepted.code} ${accepted.text}`.replace(/\s+/g, " ").trim().slice(0, 500);
    };
    try {
      return { serverReply: await Promise.race([run(), timeout]) };
    } catch (err) {
      throw classifySmtpFailure(factsOf(err, stage), server);
    } finally {
      clearTimeout(timer);
      (sock as Sock | null)?.destroy();
    }
  }
}
