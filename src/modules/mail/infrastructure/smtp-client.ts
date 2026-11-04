import "server-only";
import net from "node:net";
import tls from "node:tls";
import { toBase64 } from "@/core";
import type { SmtpServer, SmtpTransport } from "../application/ports";
import { MailErrors } from "../domain/errors";

const TIMEOUT_MS = 20_000;
type Reply = { code: number; text: string };
type Sock = net.Socket | tls.TLSSocket;

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
  private readonly onClose = () => this.fail(new Error("connection closed"));

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

  async cmd(command: string, expect: number[]): Promise<Reply> {
    this.sock.write(`${command}\r\n`);
    const r = await this.reply();
    if (!expect.includes(r.code)) throw Object.assign(new Error(`${command.split(" ")[0]} → ${r.code} ${r.text}`), { smtpCode: r.code });
    return r;
  }
}

const opened = (s: Sock, event: "connect" | "secureConnect") =>
  new Promise<void>((res, rej) => { s.once(event, () => res()); s.once("error", rej); });

async function openSocket(server: SmtpServer): Promise<Sock> {
  const s = server.security === "ssl"
    ? tls.connect({ host: server.host, port: server.port, servername: server.host })
    : net.connect({ host: server.host, port: server.port });
  await opened(s, server.security === "ssl" ? "secureConnect" : "connect");
  return s;
}

/**
 * Dependency-free SMTP client over node:net / node:tls — available in Node (next dev, tests) and in Cloudflare
 * Workers with `nodejs_compat`. `ssl` = TLS from the first byte (port 465), `starttls` = plain then upgrade
 * (port 587). AUTH PLAIN when offered, otherwise AUTH LOGIN. Port 25 is blocked on Workers.
 */
export class NodeSmtpTransport implements SmtpTransport {
  /** `connect` opens the first socket (tests pass a plain socket to a fake server); the default is the real network. */
  constructor(private readonly connect: (server: SmtpServer) => Promise<Sock> = openSocket) {}

  async send(server: SmtpServer, envelope: { from: string; to: string }, mime: string): Promise<void> {
    let sock: Sock | null = null;
    let timer: ReturnType<typeof setTimeout> | undefined;
    const timeout = new Promise<never>((_, rej) => { timer = setTimeout(() => rej(MailErrors.timeout()), TIMEOUT_MS); });
    const run = async () => {
      try {
        sock = await this.connect(server);
      } catch (e) {
        throw MailErrors.connectFailed(String(e));
      }
      const io = new SmtpLine(sock);
      const step = async <T>(fn: () => Promise<T>, onFail: (detail: string) => Error) => {
        try { return await fn(); } catch (e) { throw onFail(String((e as Error).message ?? e)); }
      };

      await step(async () => {
        const greet = await io.reply();
        if (greet.code !== 220) throw new Error(`greeting ${greet.code} ${greet.text}`);
      }, MailErrors.connectFailed);
      let ehlo = await step(() => io.cmd("EHLO nova.local", [250]), MailErrors.connectFailed);

      if (server.security === "starttls") {
        await step(() => io.cmd("STARTTLS", [220]), MailErrors.connectFailed);
        io.detach();
        const secure = tls.connect({ socket: sock, servername: server.host });
        await step(() => opened(secure, "secureConnect"), MailErrors.connectFailed);
        sock = secure;
        io.attach(secure);
        ehlo = await step(() => io.cmd("EHLO nova.local", [250]), MailErrors.connectFailed);
      }

      const b64 = (s: string) => toBase64(new TextEncoder().encode(s));
      await step(async () => {
        if (/AUTH[ =][^\n]*\bPLAIN\b/i.test(ehlo.text)) {
          await io.cmd(`AUTH PLAIN ${b64(`\u0000${server.username}\u0000${server.password}`)}`, [235]);
        } else {
          await io.cmd("AUTH LOGIN", [334]);
          await io.cmd(b64(server.username), [334]);
          await io.cmd(b64(server.password), [235]);
        }
      }, MailErrors.authFailed);

      await step(async () => {
        await io.cmd(`MAIL FROM:<${envelope.from}>`, [250]);
        await io.cmd(`RCPT TO:<${envelope.to}>`, [250, 251]);
        await io.cmd("DATA", [354]);
        // Dot-stuffing: a line starting with "." gets another "." (RFC 5321 §4.5.2).
        await io.cmd(`${mime.replace(/\r\n\./g, "\r\n..")}\r\n.`, [250]);
      }, MailErrors.rejected);
      await io.cmd("QUIT", [221]).catch(() => { /* already delivered */ });
    };
    try {
      await Promise.race([run(), timeout]);
    } finally {
      clearTimeout(timer);
      (sock as Sock | null)?.destroy();
    }
  }
}
