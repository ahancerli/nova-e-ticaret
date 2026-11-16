import { ChannelSendError, type ChannelAdapter, type ChannelCredentials, type ContactProfile, type OutboundMessage } from "../../application/ports";
import type { Channel, InboundMessage } from "../../domain/social-ai";

/**
 * Stand-in for a real channel: reads webhooks with the real adapter's parser and records sends instead of calling
 * Meta. Tests (and local trials without a Meta account) register it in place of the HTTP adapters.
 */
export class FakeChannelAdapter implements ChannelAdapter {
  readonly sent: { credentials: ChannelCredentials; message: OutboundMessage }[] = [];
  /** Set to make the next sends fail. */
  failWith: ChannelSendError | null = null;
  private seq = 0;

  constructor(private readonly real: ChannelAdapter) {}

  get channel(): Channel { return this.real.channel; }
  get webhookObject(): string { return this.real.webhookObject; }
  parse(payload: unknown): InboundMessage[] { return this.real.parse(payload); }

  async send(credentials: ChannelCredentials, message: OutboundMessage): Promise<{ externalId: string | null }> {
    if (this.failWith) throw this.failWith;
    this.sent.push({ credentials, message });
    return { externalId: `fake.${this.channel}.${++this.seq}` };
  }

  /** Answers `profileOf` (null = lookup fails); `profileCalls` counts lookups. */
  profileOf: ContactProfile | null = null;
  profileCalls = 0;
  async profile(): Promise<ContactProfile> {
    this.profileCalls++;
    if (!this.profileOf) throw new Error("no profile");
    return this.profileOf;
  }
}
