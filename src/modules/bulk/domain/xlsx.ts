/**
 * Minimal .xlsx reader / writer without dependencies (browser and Node; uses the platform's DecompressionStream).
 *
 * The reader only extracts cell text of the first worksheet — no formulas are evaluated, no macros, no external
 * links. It is defensive against hostile files: size of the file, number of zip entries and the uncompressed size
 * of every part are capped (zip bombs), XML goes through the safe parser (no DOCTYPE / entities).
 * The writer produces the downloadable templates: uncompressed ("stored") zip, inline strings, bold header row.
 */
import { parseXml, type XmlNode, type XmlObject } from "./xml";

export const MAX_FILE_BYTES = 10 * 1024 * 1024;
const MAX_PART_BYTES = 60 * 1024 * 1024;
const MAX_ENTRIES = 5000;
const LOCAL = { maxElements: 3_000_000, localNames: true };

export class SheetError extends Error {}

// --- zip ---------------------------------------------------------------------------------------------------

interface ZipEntry { name: string; method: number; compressedSize: number; size: number; offset: number }

function readEntries(buf: Uint8Array): ZipEntry[] {
  const dv = new DataView(buf.buffer, buf.byteOffset, buf.byteLength);
  let eocd = -1;
  for (let i = buf.length - 22; i >= Math.max(0, buf.length - 65_557); i--) {
    if (dv.getUint32(i, true) === 0x06054b50) { eocd = i; break; }
  }
  if (eocd < 0) throw new SheetError("Dosya geçerli bir Excel (.xlsx) dosyası değil.");
  const count = dv.getUint16(eocd + 10, true);
  let p = dv.getUint32(eocd + 16, true);
  if (count > MAX_ENTRIES) throw new SheetError("Excel dosyası çok fazla parça içeriyor.");
  const out: ZipEntry[] = [];
  for (let n = 0; n < count; n++) {
    if (p + 46 > buf.length || dv.getUint32(p, true) !== 0x02014b50) throw new SheetError("Excel dosyası bozuk.");
    const nameLen = dv.getUint16(p + 28, true), extraLen = dv.getUint16(p + 30, true), commentLen = dv.getUint16(p + 32, true);
    out.push({
      method: dv.getUint16(p + 10, true), compressedSize: dv.getUint32(p + 20, true), size: dv.getUint32(p + 24, true),
      offset: dv.getUint32(p + 42, true), name: new TextDecoder().decode(buf.subarray(p + 46, p + 46 + nameLen)),
    });
    p += 46 + nameLen + extraLen + commentLen;
  }
  return out;
}

async function inflate(data: Uint8Array, limit: number): Promise<Uint8Array> {
  const stream = new Blob([data as Uint8Array<ArrayBuffer>]).stream().pipeThrough(new DecompressionStream("deflate-raw"));
  const reader = stream.getReader();
  const chunks: Uint8Array[] = [];
  let total = 0;
  for (;;) {
    const { done, value } = await reader.read();
    if (done) break;
    total += value.byteLength;
    if (total > limit) { await reader.cancel(); throw new SheetError("Excel dosyasının içeriği çok büyük."); }
    chunks.push(value);
  }
  const out = new Uint8Array(total);
  let o = 0;
  for (const c of chunks) { out.set(c, o); o += c.byteLength; }
  return out;
}

async function readPart(buf: Uint8Array, e: ZipEntry): Promise<string> {
  const dv = new DataView(buf.buffer, buf.byteOffset, buf.byteLength);
  if (e.offset + 30 > buf.length || dv.getUint32(e.offset, true) !== 0x04034b50) throw new SheetError("Excel dosyası bozuk.");
  const start = e.offset + 30 + dv.getUint16(e.offset + 26, true) + dv.getUint16(e.offset + 28, true);
  const data = buf.subarray(start, start + e.compressedSize);
  if (e.size > MAX_PART_BYTES) throw new SheetError("Excel dosyasının içeriği çok büyük.");
  const bytes = e.method === 0 ? data : e.method === 8 ? await inflate(data, MAX_PART_BYTES) : null;
  if (!bytes) throw new SheetError("Excel dosyası desteklenmeyen bir sıkıştırma kullanıyor.");
  return new TextDecoder().decode(bytes);
}

// --- reading ----------------------------------------------------------------------------------------------

const list = (v: XmlNode | undefined): XmlNode[] => (v === undefined ? [] : Array.isArray(v) ? v : [v]);
const obj = (v: XmlNode | undefined): XmlObject => (v && typeof v === "object" && !Array.isArray(v) ? v : (Object.create(null) as XmlObject));
const textOf = (v: XmlNode | undefined): string => {
  if (v === undefined) return "";
  if (typeof v === "string") return v;
  if (Array.isArray(v)) return v.map(textOf).join("");
  return typeof v["#text"] === "string" ? v["#text"] : "";
};

/** Column letters → 0-based index ("A" → 0, "AB" → 27). */
export function colIndex(ref: string): number {
  let n = 0;
  for (const ch of ref.replace(/\d+$/, "").toUpperCase()) n = n * 26 + (ch.charCodeAt(0) - 64);
  return n - 1;
}

/** First worksheet of an .xlsx file as rows of cell texts (empty rows dropped, trailing blanks trimmed). */
export async function readXlsx(file: ArrayBuffer): Promise<string[][]> {
  if (file.byteLength > MAX_FILE_BYTES) throw new SheetError("Dosya en fazla 10 MB olabilir.");
  const buf = new Uint8Array(file);
  const entries = readEntries(buf);
  const byName = new Map(entries.map((e) => [e.name, e]));
  const part = async (name: string) => { const e = byName.get(name); return e ? readPart(buf, e) : null; };

  // first sheet in workbook order, resolved through the workbook relationships
  let sheetPath = "xl/worksheets/sheet1.xml";
  const wb = await part("xl/workbook.xml");
  const rels = await part("xl/_rels/workbook.xml.rels");
  if (wb && rels) {
    const first = obj(list(obj(obj(parseXml(wb, LOCAL).workbook).sheets).sheet)[0]);
    const rid = first["@r:id"];
    const rel = list(obj(parseXml(rels, LOCAL).Relationships).Relationship).map(obj).find((r) => r["@Id"] === rid);
    const target = typeof rel?.["@Target"] === "string" ? rel["@Target"] : null;
    if (target) sheetPath = target.startsWith("/") ? target.slice(1) : `xl/${target.replace(/^\.\//, "")}`;
  }
  const sheet = await part(sheetPath);
  if (!sheet) throw new SheetError("Excel dosyasında çalışma sayfası bulunamadı.");

  const shared: string[] = [];
  const sst = await part("xl/sharedStrings.xml");
  if (sst) {
    for (const si of list(obj(parseXml(sst, LOCAL).sst).si)) {
      const o = obj(si);
      shared.push(o.t !== undefined ? textOf(o.t) : list(o.r).map((r) => textOf(obj(r).t)).join(""));
    }
  }

  const rows: string[][] = [];
  const data = obj(obj(parseXml(sheet, LOCAL).worksheet).sheetData);
  for (const r of list(data.row)) {
    const cells: string[] = [];
    let next = 0;
    for (const c of list(obj(r).c)) {
      const cell = obj(c);
      const at = typeof cell["@r"] === "string" ? colIndex(cell["@r"]) : next;
      if (at > 200) continue;
      const t = cell["@t"];
      const raw = textOf(cell.v);
      cells[at] = t === "s" ? shared[Number(raw)] ?? "" : t === "inlineStr" ? textOf(obj(cell.is).t) || list(obj(cell.is).r).map((x) => textOf(obj(x).t)).join("") : t === "b" ? (raw === "1" ? "1" : "0") : raw;
      next = at + 1;
    }
    const filled = Array.from(cells, (v) => v ?? "");
    while (filled.length && !filled.at(-1)!.trim()) filled.pop();
    if (filled.length) rows.push(filled);
  }
  return rows;
}

/** CSV (comma or semicolon, quoted fields) → rows. Excel in Turkish locale saves ";". */
export function readCsv(text: string): string[][] {
  const src = text.charCodeAt(0) === 0xfeff ? text.slice(1) : text;
  const firstLine = src.slice(0, src.indexOf("\n") >>> 0);
  const sep = (firstLine.match(/;/g)?.length ?? 0) > (firstLine.match(/,/g)?.length ?? 0) ? ";" : ",";
  const rows: string[][] = [];
  let row: string[] = [], cur = "", quoted = false;
  for (let i = 0; i < src.length; i++) {
    const ch = src[i]!;
    if (quoted) {
      if (ch === '"' && src[i + 1] === '"') { cur += '"'; i++; }
      else if (ch === '"') quoted = false;
      else cur += ch;
    } else if (ch === '"') quoted = true;
    else if (ch === sep) { row.push(cur); cur = ""; }
    else if (ch === "\n" || ch === "\r") {
      if (ch === "\r" && src[i + 1] === "\n") i++;
      row.push(cur); cur = "";
      if (row.some((c) => c.trim())) rows.push(row);
      row = [];
    } else cur += ch;
  }
  row.push(cur);
  if (row.some((c) => c.trim())) rows.push(row);
  return rows;
}

// --- writing ----------------------------------------------------------------------------------------------

const CRC_TABLE = (() => {
  const t = new Uint32Array(256);
  for (let n = 0; n < 256; n++) {
    let c = n;
    for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
    t[n] = c >>> 0;
  }
  return t;
})();
function crc32(b: Uint8Array): number {
  let c = 0xffffffff;
  for (const x of b) c = CRC_TABLE[(c ^ x) & 0xff]! ^ (c >>> 8);
  return (c ^ 0xffffffff) >>> 0;
}

function zipStore(files: { name: string; data: string }[]): Uint8Array<ArrayBuffer> {
  const enc = new TextEncoder();
  const parts: Uint8Array[] = [];
  const central: Uint8Array[] = [];
  let offset = 0;
  for (const f of files) {
    const name = enc.encode(f.name), data = enc.encode(f.data), crc = crc32(data);
    const local = new Uint8Array(30 + name.length);
    const lv = new DataView(local.buffer);
    lv.setUint32(0, 0x04034b50, true); lv.setUint16(4, 20, true); lv.setUint16(6, 0x0800, true);
    lv.setUint32(14, crc, true); lv.setUint32(18, data.length, true); lv.setUint32(22, data.length, true); lv.setUint16(26, name.length, true);
    local.set(name, 30);
    const cen = new Uint8Array(46 + name.length);
    const cv = new DataView(cen.buffer);
    cv.setUint32(0, 0x02014b50, true); cv.setUint16(4, 20, true); cv.setUint16(6, 20, true); cv.setUint16(8, 0x0800, true);
    cv.setUint32(16, crc, true); cv.setUint32(20, data.length, true); cv.setUint32(24, data.length, true); cv.setUint16(28, name.length, true);
    cv.setUint32(42, offset, true);
    cen.set(name, 46);
    parts.push(local, data);
    central.push(cen);
    offset += local.length + data.length;
  }
  const cenSize = central.reduce((a, c) => a + c.length, 0);
  const end = new Uint8Array(22);
  const ev = new DataView(end.buffer);
  ev.setUint32(0, 0x06054b50, true); ev.setUint16(8, files.length, true); ev.setUint16(10, files.length, true);
  ev.setUint32(12, cenSize, true); ev.setUint32(16, offset, true);
  const all = [...parts, ...central, end];
  const out = new Uint8Array(all.reduce((a, c) => a + c.length, 0));
  let o = 0;
  for (const c of all) { out.set(c, o); o += c.length; }
  return out;
}

const esc = (s: string) => s.replace(/[<>&"]/g, (c) => ({ "<": "&lt;", ">": "&gt;", "&": "&amp;", '"': "&quot;" })[c]!).replace(/[\u0000-\u0008\u000b\u000c\u000e-\u001f]/g, "");
const colName = (i: number): string => (i < 26 ? String.fromCharCode(65 + i) : colName(Math.floor(i / 26) - 1) + String.fromCharCode(65 + (i % 26)));

function sheetXml(rows: string[][], widths: number[]): string {
  const cols = widths.length ? `<cols>${widths.map((w, i) => `<col min="${i + 1}" max="${i + 1}" width="${w}" customWidth="1"/>`).join("")}</cols>` : "";
  const body = rows.map((r, ri) => `<row r="${ri + 1}">${r.map((v, ci) =>
    `<c r="${colName(ci)}${ri + 1}" t="inlineStr" s="${ri === 0 ? 1 : 2}"><is><t xml:space="preserve">${esc(v)}</t></is></c>`).join("")}</row>`).join("");
  return `<?xml version="1.0" encoding="UTF-8" standalone="yes"?><worksheet xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main"><sheetViews><sheetView workbookViewId="0"><pane ySplit="1" topLeftCell="A2" activePane="bottomLeft" state="frozen"/></sheetView></sheetViews>${cols}<sheetData>${body}</sheetData></worksheet>`;
}

/** Workbook with the given sheets (all cells are text, first row bold and frozen). */
export function writeXlsx(sheets: { name: string; rows: string[][]; widths?: number[] }[]): Uint8Array<ArrayBuffer> {
  const ns = 'xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main" xmlns:r="http://schemas.openxmlformats.org/officeDocument/2006/relationships"';
  const files = [
    { name: "[Content_Types].xml", data: `<?xml version="1.0" encoding="UTF-8" standalone="yes"?><Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types"><Default Extension="rels" ContentType="application/vnd.openxmlformats-package.relationships+xml"/><Default Extension="xml" ContentType="application/xml"/><Override PartName="/xl/workbook.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.sheet.main+xml"/><Override PartName="/xl/styles.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.styles+xml"/>${sheets.map((_, i) => `<Override PartName="/xl/worksheets/sheet${i + 1}.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.worksheet+xml"/>`).join("")}</Types>` },
    { name: "_rels/.rels", data: `<?xml version="1.0" encoding="UTF-8" standalone="yes"?><Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships"><Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/officeDocument" Target="xl/workbook.xml"/></Relationships>` },
    { name: "xl/workbook.xml", data: `<?xml version="1.0" encoding="UTF-8" standalone="yes"?><workbook ${ns}><sheets>${sheets.map((s, i) => `<sheet name="${esc(s.name.slice(0, 31))}" sheetId="${i + 1}" r:id="rId${i + 1}"/>`).join("")}</sheets></workbook>` },
    { name: "xl/_rels/workbook.xml.rels", data: `<?xml version="1.0" encoding="UTF-8" standalone="yes"?><Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships">${sheets.map((_, i) => `<Relationship Id="rId${i + 1}" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/worksheet" Target="worksheets/sheet${i + 1}.xml"/>`).join("")}<Relationship Id="rId${sheets.length + 1}" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/styles" Target="styles.xml"/></Relationships>` },
    { name: "xl/styles.xml", data: `<?xml version="1.0" encoding="UTF-8" standalone="yes"?><styleSheet xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main"><fonts count="2"><font><sz val="11"/><name val="Calibri"/></font><font><b/><sz val="11"/><name val="Calibri"/></font></fonts><fills count="3"><fill><patternFill patternType="none"/></fill><fill><patternFill patternType="gray125"/></fill><fill><patternFill patternType="solid"><fgColor rgb="FFEDE9FE"/></patternFill></fill></fills><borders count="1"><border/></borders><cellStyleXfs count="1"><xf/></cellStyleXfs><cellXfs count="3"><xf/><xf fontId="1" fillId="2" applyFont="1" applyFill="1"/><xf numFmtId="49" applyNumberFormat="1"/></cellXfs></styleSheet>` },
    ...sheets.map((s, i) => ({ name: `xl/worksheets/sheet${i + 1}.xml`, data: sheetXml(s.rows, s.widths ?? []) })),
  ];
  return zipStore(files);
}
