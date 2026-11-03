"use client";

import Link from "next/link";
import { useEffect, useState } from "react";
import { ExternalLink, History } from "lucide-react";
import { notify } from "@/lib/toast";
import { AdminDrawer } from "@/components/admin/AdminDrawer";
import { Skeleton } from "@/components/admin/Skeleton";
import type { AuditEntryDetail, AuditEntrySummary } from "@/modules/audit/domain/audit";
import { auditApi } from "./api";
import { dateTime } from "./format";

/** Right drawer: one audit entry — who / when / which record, the redacted change set, related entries. */
export function AuditDetailDrawer({ id, onClose, onOpen, onRecordHistory }: {
  id: string | null;
  onClose: () => void;
  onOpen: (id: string) => void;
  onRecordHistory: (entityType: string, entityId: string) => void;
}) {
  const [entry, setEntry] = useState<AuditEntryDetail | null>(null);
  const [failedId, setFailedId] = useState<string | null>(null);

  useEffect(() => {
    if (!id) return;
    let live = true;
    auditApi.get(id).then(
      (r) => { if (live) setEntry(r.data); },
      (err) => {
        if (!live) return;
        setFailedId(id);
        notify.error(err, { id: "audit-detail", fallback: "Denetim kaydı yüklenemedi." });
      },
    );
    return () => { live = false; };
  }, [id]);

  const loading = !!id && entry?.id !== id && failedId !== id;
  const e = entry?.id === id ? entry : null;

  return (
    <AdminDrawer open={!!id} onClose={onClose} title={e?.actionLabel ?? "Denetim kaydı"} subtitle={e ? dateTime.format(new Date(e.createdAt)) : undefined}>
      {loading ? (
        <div className="space-y-3 p-5"><Skeleton className="h-5 w-2/3" /><Skeleton className="h-24 w-full" /><Skeleton className="h-40 w-full" /></div>
      ) : !e ? (
        <p className="p-5 text-sm text-slate-500">Kayıt gösterilemiyor.</p>
      ) : (
        <div className="space-y-6 p-5 text-sm">
          <dl className="grid grid-cols-[8rem_1fr] gap-x-3 gap-y-2">
            <dt className="text-slate-500">İşlem</dt>
            <dd><span className="font-medium text-slate-800">{e.actionLabel}</span> <code className="ml-1 rounded bg-slate-100 px-1 py-0.5 text-[11px] text-slate-600">{e.action}</code></dd>
            <dt className="text-slate-500">Kişi</dt>
            <dd>{e.actor ? <>{e.actor.name} <span className="text-slate-500">· {e.actor.email}</span></> : "Sistem"}</dd>
            <dt className="text-slate-500">Kayıt</dt>
            <dd className="min-w-0">
              <span className="text-slate-800">{e.entityLabel}</span>
              {e.entityName ? <span className="text-slate-600"> · {e.entityName}</span> : null}
              {e.entityId ? <span className="block truncate font-mono text-[11px] text-slate-400">{e.entityId}</span> : null}
            </dd>
            <dt className="text-slate-500">İstek no</dt>
            <dd className="break-all font-mono text-xs text-slate-600">{e.requestId ?? "—"}</dd>
            <dt className="text-slate-500">IP</dt>
            <dd className="text-slate-600">{e.hasIp ? "Kaydedildi (karma olarak saklanır)" : "Kaydedilmedi"}</dd>
          </dl>

          {e.entityId ? (
            <div className="flex flex-wrap gap-2">
              {e.entityHref ? (
                <Link href={e.entityHref} className="inline-flex h-9 items-center gap-2 rounded-lg border border-slate-200 px-3 text-sm font-medium text-slate-700 hover:bg-slate-50">
                  <ExternalLink className="h-4 w-4" /> Kayda git
                </Link>
              ) : null}
              <button type="button" onClick={() => onRecordHistory(e.entityType, e.entityId!)}
                className="inline-flex h-9 items-center gap-2 rounded-lg border border-slate-200 px-3 text-sm font-medium text-slate-700 hover:bg-slate-50">
                <History className="h-4 w-4" /> Bu kaydın tüm geçmişi
              </button>
            </div>
          ) : null}

          <section>
            <h3 className="mb-2 text-xs font-semibold uppercase tracking-wide text-slate-500">Değişiklik</h3>
            <DiffView diff={e.diff} />
          </section>

          {e.sameRequest.length ? (
            <section>
              <h3 className="mb-2 text-xs font-semibold uppercase tracking-wide text-slate-500">Aynı istekteki diğer kayıtlar ({e.sameRequest.length})</h3>
              <EntryList entries={e.sameRequest} onOpen={onOpen} />
            </section>
          ) : null}

          {e.entityHistory.length ? (
            <section>
              <h3 className="mb-2 text-xs font-semibold uppercase tracking-wide text-slate-500">Bu kayıttaki diğer işlemler</h3>
              <EntryList entries={e.entityHistory} onOpen={onOpen} />
            </section>
          ) : null}
        </div>
      )}
    </AdminDrawer>
  );
}

const isPlainObject = (v: unknown): v is Record<string, unknown> => !!v && typeof v === "object" && !Array.isArray(v);

function DiffValue({ value }: { value: unknown }) {
  if (value === null || value === undefined || value === "") return <span className="text-slate-400">—</span>;
  if (typeof value === "boolean") return <>{value ? "Evet" : "Hayır"}</>;
  if (typeof value === "string" || typeof value === "number") return <span className="break-words">{String(value)}</span>;
  if (Array.isArray(value) && value.every((v) => typeof v !== "object" || v === null)) {
    return value.length ? <span className="break-words">{value.map(String).join(", ")}</span> : <span className="text-slate-400">—</span>;
  }
  return <pre className="max-h-60 overflow-auto rounded-lg bg-slate-50 p-2 font-mono text-[11px] leading-relaxed text-slate-700">{JSON.stringify(value, null, 2)}</pre>;
}

/** Change set as written by the module (shape varies by action): flat objects as a table, anything else as JSON. */
function DiffView({ diff }: { diff: unknown }) {
  if (diff === null || (isPlainObject(diff) && Object.keys(diff).length === 0)) {
    return <p className="text-slate-500">Bu işlem için ayrıntı kaydedilmemiş.</p>;
  }
  if (!isPlainObject(diff)) return <DiffValue value={diff} />;
  return (
    <div className="overflow-hidden rounded-xl border border-slate-200">
      <table className="w-full text-sm">
        <tbody className="divide-y divide-slate-100">
          {Object.entries(diff).map(([k, v]) => (
            <tr key={k} className="align-top">
              <th scope="row" className="w-36 bg-slate-50/70 px-3 py-2 text-left font-mono text-[11px] font-medium text-slate-500">{k}</th>
              <td className="px-3 py-2 text-slate-700"><DiffValue value={v} /></td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

function EntryList({ entries, onOpen }: { entries: AuditEntrySummary[]; onOpen: (id: string) => void }) {
  return (
    <ul className="divide-y divide-slate-100 overflow-hidden rounded-xl border border-slate-200">
      {entries.map((x) => (
        <li key={x.id}>
          <button type="button" onClick={() => onOpen(x.id)} className="flex w-full items-start justify-between gap-3 px-3 py-2 text-left hover:bg-slate-50">
            <span className="min-w-0">
              <span className="block truncate font-medium text-slate-800">{x.actionLabel}</span>
              <span className="block truncate text-xs text-slate-500">{x.entityLabel}{x.entityName ? ` · ${x.entityName}` : ""}{x.actor ? ` · ${x.actor.name}` : ""}</span>
            </span>
            <span className="flex-none text-xs tabular-nums text-slate-500">{dateTime.format(new Date(x.createdAt))}</span>
          </button>
        </li>
      ))}
    </ul>
  );
}
