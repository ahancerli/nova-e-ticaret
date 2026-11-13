"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import { useCallback, useEffect, useRef, useState } from "react";
import { Bell, CheckCheck } from "lucide-react";
import { Popover } from "@/components/ui/Popover";
import type { NotificationSummary, NotificationView } from "@/modules/notifications/domain/notification";
import { NOTIFICATIONS_CHANGED, notificationsApi } from "./api";
import { NotificationIcon, timeAgo } from "./ui";

const POLL_MS = 60_000;

/** Top-bar bell: unread badge (polled every minute and when the tab becomes visible), latest notifications, read-all. */
export function NotificationBell({ buttonClassName }: { buttonClassName: string }) {
  const router = useRouter();
  const [data, setData] = useState<NotificationSummary | null>(null);
  const inflight = useRef<AbortController | null>(null);

  const refresh = useCallback(async () => {
    inflight.current?.abort();
    const ctl = new AbortController();
    inflight.current = ctl;
    try {
      setData((await notificationsApi.summary(ctl.signal)).data);
    } catch {
      /* the badge simply keeps its last value; 401 is handled by the shell */
    }
  }, []);

  useEffect(() => {
    const first = setTimeout(() => void refresh(), 0);
    const timer = setInterval(() => { if (document.visibilityState === "visible") void refresh(); }, POLL_MS);
    const onVisible = () => { if (document.visibilityState === "visible") void refresh(); };
    document.addEventListener("visibilitychange", onVisible);
    window.addEventListener(NOTIFICATIONS_CHANGED, refresh);
    return () => {
      clearTimeout(first);
      clearInterval(timer);
      document.removeEventListener("visibilitychange", onVisible);
      window.removeEventListener(NOTIFICATIONS_CHANGED, refresh);
      inflight.current?.abort();
    };
  }, [refresh]);

  const open = async (n: NotificationView, close: () => void) => {
    close();
    if (!n.readAt) {
      setData((d) => d && { unread: Math.max(0, d.unread - 1), latest: d.latest.map((x) => (x.id === n.id ? { ...x, readAt: new Date().toISOString() } : x)) });
      void notificationsApi.read([n.id]).catch(() => {});
    }
    if (n.href) router.push(n.href);
  };

  const readAll = async () => {
    setData((d) => d && { unread: 0, latest: d.latest.map((x) => ({ ...x, readAt: x.readAt ?? new Date().toISOString() })) });
    await notificationsApi.readAll().catch(() => {});
    void refresh();
  };

  const unread = data?.unread ?? 0;
  return (
    <Popover label={unread ? `Bildirimler, ${unread} okunmamış` : "Bildirimler"} buttonClassName={`${buttonClassName} relative`} panelClassName="w-[min(380px,calc(100vw-1.5rem))]"
      button={
        <>
          {/* keys differ per sibling (a shared key duplicates the bell when the count changes); changing them replays the animations */}
          <Bell key={`bell-${unread}`} className={`h-[18px] w-[18px] ${unread ? "origin-top animate-ring motion-reduce:animate-none" : ""}`} />
          {unread ? (
            <span key={`badge-${unread}`} className="absolute right-1 top-1 grid h-[18px] min-w-[18px] animate-bump place-items-center rounded-full bg-red-500 px-1 text-[10px] font-bold tabular-nums text-white ring-2 ring-white">
              {unread > 99 ? "99+" : unread}
            </span>
          ) : null}
        </>
      }>
      {(close) => (
        <div>
          <div className="flex items-center justify-between gap-2 border-b border-slate-100 px-4 py-3">
            <p className="text-sm font-semibold text-slate-800">Bildirimler</p>
            <div className="flex items-center gap-1.5">
              <span className="rounded-full bg-slate-100 px-2 py-0.5 text-[11px] font-medium text-slate-500">{unread} yeni</span>
              {unread ? (
                <button type="button" onClick={() => void readAll()} title="Tümünü okundu say" aria-label="Tümünü okundu say"
                  className="grid size-7 place-items-center rounded-lg text-slate-500 transition hover:bg-slate-100 hover:text-[#5b4fe0]">
                  <CheckCheck className="size-4" />
                </button>
              ) : null}
            </div>
          </div>
          {data && data.latest.length ? (
            <ul className="max-h-[min(420px,60vh)] divide-y divide-slate-100 overflow-y-auto overscroll-contain">
              {data.latest.map((n) => (
                <li key={n.id}>
                  <button type="button" onClick={() => void open(n, close)} className={`flex w-full gap-3 px-4 py-3 text-left transition hover:bg-slate-50 ${n.readAt ? "" : "bg-[#7367f0]/[0.04]"}`}>
                    <NotificationIcon type={n.type} severity={n.severity} />
                    <span className="min-w-0 flex-1">
                      <span className={`block truncate text-sm ${n.readAt ? "text-slate-600" : "font-semibold text-slate-800"}`}>{n.title}</span>
                      {n.body ? <span className="line-clamp-2 text-xs text-slate-500">{n.body}</span> : null}
                      <span className="mt-0.5 block text-[11px] text-slate-400">{timeAgo(n.createdAt)}</span>
                    </span>
                    {!n.readAt ? <span className="mt-1.5 size-2 flex-none rounded-full bg-[#7367f0]" aria-label="Okunmadı" /> : null}
                  </button>
                </li>
              ))}
            </ul>
          ) : (
            <div className="flex flex-col items-center gap-2 px-6 py-10 text-center">
              <span className="grid size-11 place-items-center rounded-full bg-slate-100 text-slate-400"><Bell className="h-5 w-5" /></span>
              <p className="text-sm font-medium text-slate-700">Her şey yolunda</p>
              <p className="text-xs text-slate-500">Yeni sipariş, onay bekleyen yorum ve ödeme uyarıları burada görünür.</p>
            </div>
          )}
          <div className="border-t border-slate-100 p-1.5">
            <Link href="/admin/bildirimler" onClick={close} className="block rounded-lg px-3 py-2 text-center text-sm font-medium text-[#5b4fe0] transition hover:bg-slate-50">
              Tüm bildirimler
            </Link>
          </div>
        </div>
      )}
    </Popover>
  );
}
