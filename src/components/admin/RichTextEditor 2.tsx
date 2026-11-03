"use client";

import { useCallback, useEffect, useRef, useState, type ComponentType, type KeyboardEvent } from "react";
import {
  Bold, Braces, Code2, Heading2, Heading3, Italic, Link2, List, ListOrdered, Pilcrow, Quote, Redo2, Underline, Undo2, Unlink,
} from "lucide-react";
import { sanitizeRichHtml } from "@/core/security/sanitize-html";
import { Popover } from "@/components/ui/Popover";

export interface EditorVariable {
  name: string;
  label: string;
}

type Command = { id: string; label: string; icon: ComponentType<{ className?: string }>; tracks?: boolean };

/** Toolbar layout (groups) — static, so rendering never touches the editor. */
const COMMANDS: Command[][] = [
  [
    { id: "p", label: "Paragraf", icon: Pilcrow, tracks: true },
    { id: "h2", label: "Başlık", icon: Heading2, tracks: true },
    { id: "h3", label: "Alt başlık", icon: Heading3, tracks: true },
  ],
  [
    { id: "b", label: "Kalın (Ctrl+B)", icon: Bold, tracks: true },
    { id: "i", label: "İtalik (Ctrl+I)", icon: Italic, tracks: true },
    { id: "u", label: "Altı çizili (Ctrl+U)", icon: Underline, tracks: true },
  ],
  [
    { id: "ul", label: "Madde işaretli liste", icon: List, tracks: true },
    { id: "ol", label: "Numaralı liste", icon: ListOrdered, tracks: true },
    { id: "quote", label: "Alıntı", icon: Quote, tracks: true },
  ],
  [
    { id: "link", label: "Bağlantı ekle", icon: Link2 },
    { id: "unlink", label: "Bağlantıyı kaldır", icon: Unlink },
  ],
  [
    { id: "undo", label: "Geri al (Ctrl+Z)", icon: Undo2 },
    { id: "redo", label: "Yinele (Ctrl+Y)", icon: Redo2 },
  ],
];

/** Command id → document.execCommand (name, value). */
const COMMAND_ACTIONS: Record<string, [string, string?]> = {
  p: ["formatBlock", "P"], h2: ["formatBlock", "H2"], h3: ["formatBlock", "H3"], quote: ["formatBlock", "BLOCKQUOTE"],
  b: ["bold"], i: ["italic"], u: ["underline"], ul: ["insertUnorderedList"], ol: ["insertOrderedList"],
  unlink: ["unlink"], undo: ["undo"], redo: ["redo"],
};

/** Toolbar buttons that show an on/off state for the current selection. */
const INLINE_STATES = { b: "bold", i: "italic", u: "underline", ul: "insertUnorderedList", ol: "insertOrderedList" } as const;
const BLOCK_STATES = { p: "p", h2: "h2", h3: "h3", quote: "blockquote" } as const;

function readActiveStates(): Set<string> {
  const on = new Set<string>();
  try {
    for (const [id, cmd] of Object.entries(INLINE_STATES)) if (document.queryCommandState(cmd)) on.add(id);
    const block = document.queryCommandValue("formatBlock").toLowerCase();
    for (const [id, tag] of Object.entries(BLOCK_STATES)) if (block === tag) on.add(id);
  } catch {
    // queryCommand* can throw outside an editable selection
  }
  return on;
}

const SAFE_LINK = /^(https?:\/\/|\/(?!\/)|mailto:|tel:)/i;

/**
 * Rich text editor for admin content (legal texts, pages). Visual mode uses contentEditable with the browser's
 * editing commands; output is limited to the sanitizer's tag set (pasted Word/HTML is cleaned on the way in and
 * the server sanitizes again on save). "HTML" mode edits the markup directly. {{variables}} are inserted as text.
 */
export function RichTextEditor({ id, value, onChange, variables = [], invalid = false, describedBy, minHeight = 420 }: {
  id: string;
  value: string;
  onChange: (html: string) => void;
  variables?: EditorVariable[];
  invalid?: boolean;
  describedBy?: string;
  minHeight?: number;
}) {
  const editorRef = useRef<HTMLDivElement>(null);
  const sourceRef = useRef<HTMLTextAreaElement>(null);
  const savedRange = useRef<Range | null>(null);
  const [mode, setMode] = useState<"visual" | "source">("visual");
  const [active, setActive] = useState<Set<string>>(() => new Set());
  const [linkOpen, setLinkOpen] = useState(false);
  const [linkUrl, setLinkUrl] = useState("");
  const [linkError, setLinkError] = useState("");

  // Sync external value (initial load, template applied) into the editable area without fighting the caret.
  useEffect(() => {
    const el = editorRef.current;
    if (mode !== "visual" || !el) return;
    if (document.activeElement !== el && el.innerHTML !== value) el.innerHTML = value;
  }, [value, mode]);

  useEffect(() => {
    const onSel = () => {
      const sel = document.getSelection();
      if (sel && editorRef.current && sel.anchorNode && editorRef.current.contains(sel.anchorNode)) setActive(readActiveStates());
    };
    document.addEventListener("selectionchange", onSel);
    return () => document.removeEventListener("selectionchange", onSel);
  }, []);

  const emit = useCallback(() => {
    if (editorRef.current) onChange(editorRef.current.innerHTML);
  }, [onChange]);

  // execCommand is deprecated but remains the only cross-browser way to edit contentEditable with native undo.
  const exec = (command: string, arg?: string) => {
    editorRef.current?.focus();
    document.execCommand(command, false, arg);
    emit();
  };

  const saveSelection = () => {
    const sel = document.getSelection();
    savedRange.current = sel && sel.rangeCount && editorRef.current?.contains(sel.anchorNode) ? sel.getRangeAt(0).cloneRange() : null;
  };
  const restoreSelection = () => {
    const sel = document.getSelection();
    editorRef.current?.focus();
    if (savedRange.current && sel) {
      sel.removeAllRanges();
      sel.addRange(savedRange.current);
    }
  };

  const insertVariable = (name: string) => {
    const token = `{{${name}}}`;
    if (mode === "source") {
      const ta = sourceRef.current;
      if (!ta) return;
      const { selectionStart: a, selectionEnd: b } = ta;
      const next = value.slice(0, a) + token + value.slice(b);
      onChange(next);
      requestAnimationFrame(() => { ta.focus(); ta.setSelectionRange(a + token.length, a + token.length); });
      return;
    }
    restoreSelection();
    document.execCommand("insertText", false, token);
    emit();
  };

  const applyLink = () => {
    const url = linkUrl.trim();
    if (!SAFE_LINK.test(url)) {
      setLinkError("https://, / , mailto: veya tel: ile başlamalı.");
      return;
    }
    restoreSelection();
    if (document.getSelection()?.isCollapsed) document.execCommand("insertText", false, url);
    else document.execCommand("createLink", false, url);
    emit();
    setLinkOpen(false);
    setLinkUrl("");
    setLinkError("");
  };

  const runCommand = (id: string) => {
    if (id === "link") {
      saveSelection();
      setLinkOpen((o) => !o);
      return;
    }
    const [command, arg] = COMMAND_ACTIONS[id]!;
    exec(command, arg);
  };

  const onToolbarKey = (e: KeyboardEvent<HTMLDivElement>) => {
    if (e.key !== "ArrowRight" && e.key !== "ArrowLeft") return;
    const buttons = [...e.currentTarget.querySelectorAll<HTMLButtonElement>("button:not([disabled])")];
    const i = buttons.indexOf(document.activeElement as HTMLButtonElement);
    if (i < 0) return;
    e.preventDefault();
    buttons[(i + (e.key === "ArrowRight" ? 1 : -1) + buttons.length) % buttons.length]?.focus();
  };

  const btn = "inline-flex size-8 items-center justify-center rounded-md text-slate-600 transition hover:bg-slate-100 hover:text-slate-900 disabled:pointer-events-none disabled:opacity-40";

  return (
    <div className={`overflow-hidden rounded-xl border bg-white ${invalid ? "border-red-400" : "border-slate-200"} focus-within:border-[#7367f0]/60 focus-within:ring-2 focus-within:ring-[#7367f0]/15`}>
      <div role="toolbar" aria-label="Biçimlendirme" aria-controls={id} onKeyDown={onToolbarKey}
        className="sticky top-0 z-10 flex flex-wrap items-center gap-1 border-b border-slate-200 bg-slate-50/90 px-2 py-1.5 backdrop-blur">
        {COMMANDS.map((group, gi) => (
          <div key={gi} className="flex items-center gap-0.5 border-r border-slate-200 pr-1 last:border-r-0">
            {group.map((c) => {
              const on = mode === "visual" && active.has(c.id);
              return (
                <button key={c.id} type="button" title={c.label} aria-label={c.label} aria-pressed={c.tracks ? on : undefined}
                  disabled={mode === "source"} onMouseDown={(e) => e.preventDefault()} onClick={() => runCommand(c.id)}
                  className={`${btn} ${on ? "bg-[#7367f0]/10 text-[#5b4fe0]" : ""}`}>
                  <c.icon className="size-4" />
                </button>
              );
            })}
          </div>
        ))}

        {variables.length > 0 ? (
          <Popover label="Değişken ekle" align="start" panelClassName="w-72"
            buttonClassName="inline-flex h-8 items-center gap-1.5 rounded-md px-2 text-sm font-medium text-slate-600 hover:bg-slate-100 hover:text-slate-900"
            button={<><Braces className="size-4" />Değişken</>}>
            {(close) => (
              <div className="max-h-72 overflow-y-auto p-1" onMouseDown={(e) => e.preventDefault()}>
                <p className="px-2 py-1.5 text-xs text-slate-500">Site ayarlarındaki değerle doldurulur.</p>
                {variables.map((v) => (
                  <button key={v.name} type="button" onClick={() => { insertVariable(v.name); close(); }}
                    className="flex w-full flex-col items-start rounded-lg px-2 py-1.5 text-left hover:bg-slate-50">
                    <span className="text-sm text-slate-800">{v.label}</span>
                    <span className="font-mono text-[11px] text-slate-500">{`{{${v.name}}}`}</span>
                  </button>
                ))}
              </div>
            )}
          </Popover>
        ) : null}

        <button type="button" aria-pressed={mode === "source"} onMouseDown={(e) => { if (mode === "visual") saveSelection(); e.preventDefault(); }}
          onClick={() => setMode((m) => (m === "visual" ? "source" : "visual"))}
          className={`ml-auto inline-flex h-8 items-center gap-1.5 rounded-md px-2 text-sm font-medium ${mode === "source" ? "bg-slate-800 text-white" : "text-slate-600 hover:bg-slate-100"}`}>
          <Code2 className="size-4" />HTML
        </button>
      </div>

      {linkOpen && mode === "visual" ? (
        <div className="flex flex-wrap items-start gap-2 border-b border-slate-200 bg-white px-3 py-2">
          <div className="min-w-0 flex-1">
            <input autoFocus type="text" inputMode="url" value={linkUrl} placeholder="https://… veya /sayfa/…" aria-label="Bağlantı adresi"
              onChange={(e) => { setLinkUrl(e.target.value); setLinkError(""); }}
              onKeyDown={(e) => { if (e.key === "Enter") { e.preventDefault(); applyLink(); } if (e.key === "Escape") setLinkOpen(false); }}
              className="input h-9 border-slate-200 text-sm" aria-invalid={!!linkError} />
            {linkError ? <p className="mt-1 text-xs text-red-600">{linkError}</p> : null}
          </div>
          <button type="button" onClick={applyLink} className="h-9 rounded-lg bg-[#7367f0] px-3 text-sm font-medium text-white hover:bg-[#6559df]">Bağlantıyı ekle</button>
          <button type="button" onClick={() => setLinkOpen(false)} className="h-9 rounded-lg px-3 text-sm text-slate-600 hover:bg-slate-100">Vazgeç</button>
        </div>
      ) : null}

      {mode === "visual" ? (
        <div
          id={id}
          ref={editorRef}
          role="textbox"
          aria-multiline="true"
          aria-invalid={invalid}
          aria-describedby={describedBy}
          contentEditable
          suppressContentEditableWarning
          spellCheck
          lang="tr"
          onInput={emit}
          onBlur={() => { saveSelection(); emit(); }}
          onPaste={(e) => {
            e.preventDefault();
            const html = e.clipboardData.getData("text/html");
            if (html) document.execCommand("insertHTML", false, sanitizeRichHtml(html));
            else document.execCommand("insertText", false, e.clipboardData.getData("text/plain"));
            emit();
          }}
          className="rich-text max-w-none px-5 py-4 text-sm text-slate-700 outline-none"
          style={{ minHeight }}
        />
      ) : (
        <textarea id={id} ref={sourceRef} value={value} onChange={(e) => onChange(e.target.value)} spellCheck={false} aria-invalid={invalid} aria-describedby={describedBy}
          className="block w-full resize-y bg-slate-950 px-5 py-4 font-mono text-[12.5px] leading-relaxed text-slate-100 outline-none"
          style={{ minHeight }} />
      )}
    </div>
  );
}
