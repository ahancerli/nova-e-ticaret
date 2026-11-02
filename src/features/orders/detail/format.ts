import type { ComponentType } from "react";
import { AlertTriangle, Ban, Banknote, CheckCheck, CircleDollarSign, ClipboardList, MessageSquarePlus, PackageCheck, PackageOpen, RotateCcw, ShoppingBag, StickyNote, Truck, XCircle } from "lucide-react";
import type { OrderActionId } from "@/lib/order-rules";

export const dt = new Intl.DateTimeFormat("tr-TR", { dateStyle: "medium", timeStyle: "short", timeZone: "Europe/Istanbul" });
export const fmt = (v: string | null | undefined) => (v ? dt.format(new Date(v)) : "—");
export const rel = (v: string) => {
  const diff = Date.now() - new Date(v).getTime();
  const m = Math.round(diff / 60000);
  if (m < 1) return "az önce";
  if (m < 60) return `${m} dk önce`;
  const h = Math.round(m / 60);
  if (h < 24) return `${h} sa önce`;
  const d = Math.round(h / 24);
  return d < 30 ? `${d} gün önce` : fmt(v);
};
export const tlToMinor = (s: string) => {
  const n = Number(s.trim().replace(/\./g, "").replace(",", "."));
  return s.trim() && Number.isFinite(n) && n >= 0 ? Math.round(n * 100) : null;
};
export const minorToTl = (m: number) => (m / 100).toFixed(2).replace(".", ",");

export const ACTION_ICON: Record<OrderActionId, ComponentType<{ className?: string }>> = {
  reconcile: Banknote, prepare: PackageOpen, ship: Truck, deliver: PackageCheck, complete: CheckCheck, cancel: Ban, refund: RotateCcw, note: MessageSquarePlus,
};

export const EVENT_META: Record<string, { label: string; icon: ComponentType<{ className?: string }>; tone: string }> = {
  placed: { label: "Sipariş oluşturuldu", icon: ShoppingBag, tone: "bg-indigo-50 text-[#7367f0]" },
  payment_captured: { label: "Ödeme alındı", icon: CircleDollarSign, tone: "bg-emerald-50 text-emerald-600" },
  payment_mismatch: { label: "Havale tutarı uyuşmadı", icon: AlertTriangle, tone: "bg-amber-50 text-amber-600" },
  status_changed: { label: "Durum güncellendi", icon: ClipboardList, tone: "bg-violet-50 text-violet-600" },
  shipment_created: { label: "Kargoya verildi", icon: Truck, tone: "bg-blue-50 text-blue-600" },
  delivered: { label: "Teslim edildi", icon: PackageCheck, tone: "bg-emerald-50 text-emerald-600" },
  cancelled: { label: "Sipariş iptal edildi", icon: XCircle, tone: "bg-red-50 text-red-600" },
  refund_requested: { label: "İade başlatıldı", icon: RotateCcw, tone: "bg-amber-50 text-amber-600" },
  refunded: { label: "İade tamamlandı", icon: RotateCcw, tone: "bg-emerald-50 text-emerald-600" },
  refund_failed: { label: "İade başarısız", icon: AlertTriangle, tone: "bg-red-50 text-red-600" },
  note: { label: "Not", icon: StickyNote, tone: "bg-slate-100 text-slate-600" },
};

export type Dialog = { action: Exclude<OrderActionId, "ship" | "note"> } | null;
