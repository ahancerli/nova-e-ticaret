"use client";

import { api } from "@/lib/api-client";
import type {
  BotSettings, BotSettingsView, Channel, ChannelOverview, ChannelView, ConversationDetail, ConversationList, ConversationStatus, MetaAppView, ReferralMap, ReferralMapInput,
  ReferralMapView, ToolTrace,
} from "@/modules/social-ai";

const BASE = "/api/admin/social-ai";
const channelUrl = (c: Channel) => `${BASE}/channels/${c}`;

export interface MetaAppForm { appId: string; appSecret: string; igAppId: string; igAppSecret: string; waConfigId: string; expectedUpdatedAt: string }
export interface PreviewReply { messages: string[]; handoffReason: string | null; tools: ToolTrace[] }
export interface ConversationQuery { channel?: Channel; status?: ConversationStatus; source?: string; from?: string; to?: string; q?: string; page: number; pageSize: number }

export const socialAiApi = {
  overview: (c: Channel) => api<ChannelOverview>(channelUrl(c)),
  saveApp: (input: MetaAppForm) => api<MetaAppView>(`${BASE}/app`, { method: "PUT", json: input }),
  /** Exchanges the code at Meta, subscribes webhooks, reads the number. */
  connectWhatsApp: (input: { code: string; wabaId: string; phoneNumberId: string }) => api<ChannelView>(`${BASE}/whatsapp/connect`, { method: "POST", json: input, timeoutMs: 60_000 }),
  completeInstagram: (input: { code?: string | null; state?: string | null; denied?: boolean }) => api<ChannelView>(`${BASE}/instagram/complete`, { method: "POST", json: input, timeoutMs: 60_000 }),
  connectManually: (c: Channel, input: { externalId: string; accountId?: string | null; accessToken: string }) => api<ChannelView>(`${channelUrl(c)}/manual`, { method: "POST", json: input, timeoutMs: 60_000 }),
  updateChannel: (c: Channel, input: { isEnabled: boolean; welcomeMessage?: string | null; expectedUpdatedAt: string }) => api<ChannelView>(channelUrl(c), { method: "PUT", json: input }),
  disconnect: (c: Channel) => api<{ disconnected: true }>(channelUrl(c), { method: "DELETE", json: {}, timeoutMs: 40_000 }),
  test: (c: Channel) => api<{ ok: true; displayName: string | null }>(`${channelUrl(c)}/test`, { method: "POST", json: {}, timeoutMs: 60_000 }),

  saveSettings: (input: BotSettings & { expectedUpdatedAt: string }) => api<BotSettingsView>(`${BASE}/settings`, { method: "PUT", json: input }),
  /** One bot answer can take several tool rounds. */
  preview: (input: { channel: Channel; settings?: BotSettings; messages: { role: "user" | "assistant"; text: string }[]; referralMapId?: string | null }) =>
    api<PreviewReply>(`${BASE}/preview`, { method: "POST", json: input, timeoutMs: 120_000 }),
  referrals: () => api<ReferralMapView[]>(`${BASE}/referrals`),
  createReferral: (input: ReferralMapInput) => api<ReferralMap>(`${BASE}/referrals`, { method: "POST", json: input }),
  updateReferral: (id: string, input: ReferralMapInput) => api<ReferralMap>(`${BASE}/referrals/${id}`, { method: "PUT", json: input }),
  deleteReferral: (id: string) => api<{ deleted: true }>(`${BASE}/referrals/${id}`, { method: "DELETE", json: {} }),

  conversations: (q: ConversationQuery, signal?: AbortSignal) => {
    const params = new URLSearchParams();
    for (const [k, v] of Object.entries(q)) if (v !== undefined && v !== "") params.set(k, String(v));
    return api<ConversationList>(`${BASE}/conversations?${params}`, { signal });
  },
  conversation: (id: string, signal?: AbortSignal) => api<ConversationDetail>(`${BASE}/conversations/${id}`, { signal }),
  reply: (id: string, text: string) => api<{ messageId: string; delivery: "sent" | "blocked" | "failed" | "pending" }>(`${BASE}/conversations/${id}/reply`, { method: "POST", json: { text }, timeoutMs: 40_000 }),
  setStatus: (id: string, status: ConversationStatus) => api<{ status: ConversationStatus }>(`${BASE}/conversations/${id}/status`, { method: "PUT", json: { status } }),
  markRead: (id: string) => api<{ read: true }>(`${BASE}/conversations/${id}/read`, { method: "POST", json: {} }),
};
