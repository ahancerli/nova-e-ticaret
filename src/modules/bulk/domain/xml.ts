/**
 * Small, safe XML → plain-data parser (no I/O, runs on Workers and in the browser).
 *
 * Supplier feeds and the XML inside .xlsx files are data documents, so the parser keeps exactly that: elements,
 * attributes, text and CDATA. Security by construction:
 *  - DOCTYPE with an internal subset or any <!ENTITY> is refused (no XXE, no entity expansion "billion laughs");
 *    only the five predefined entities and numeric character references are decoded.
 *  - Depth and element count are capped; nodes are prototype-less objects, so keys like "__proto__" are plain data.
 *
 * Shape: an element with neither attributes nor child elements becomes its text (string); otherwise an object with
 * "@attr" keys, child element names as keys (an array when the name repeats) and "#text" for mixed text.
 * `parseXml("<a x='1'><b>1</b><b>2</b></a>")` → `{ a: { "@x": "1", b: ["1", "2"] } }`.
 */

export type XmlNode = string | XmlObject | XmlNode[];
export interface XmlObject { [key: string]: XmlNode }

export class XmlError extends Error {
  constructor(message: string, readonly position: number) {
    super(message);
  }
}

export interface XmlLimits {
  maxDepth?: number;
  maxElements?: number;
  /** Drop namespace prefixes of element names ("x:row" → "row"); spreadsheet parts are read this way. */
  localNames?: boolean;
}

const ENTITIES: Record<string, string> = { lt: "<", gt: ">", amp: "&", quot: '"', apos: "'" };

export function decodeEntities(s: string): string {
  if (!s.includes("&")) return s;
  return s.replace(/&(#x[0-9a-fA-F]{1,6}|#[0-9]{1,7}|[a-zA-Z]{2,8});/g, (m, e: string) => {
    if (e[0] === "#") {
      const code = e[1] === "x" || e[1] === "X" ? parseInt(e.slice(2), 16) : parseInt(e.slice(1), 10);
      return code > 0 && code <= 0x10ffff && !(code >= 0xd800 && code <= 0xdfff) ? String.fromCodePoint(code) : "";
    }
    return ENTITIES[e] ?? m;
  });
}

const node = (): XmlObject => Object.create(null) as XmlObject;

function append(parent: XmlObject, key: string, value: XmlNode) {
  const prev = parent[key];
  if (prev === undefined) parent[key] = value;
  else if (Array.isArray(prev)) prev.push(value);
  else parent[key] = [prev, value];
}

const NAME = /^[A-Za-z_:][-A-Za-z0-9_.:]*/;
const ATTR = /([A-Za-z_:][-A-Za-z0-9_.:]*)\s*=\s*("([^"]*)"|'([^']*)')/g;

interface Frame { name: string; key: string; obj: XmlObject; text: string; hasChildren: boolean; hasAttrs: boolean }

export function parseXml(input: string, limits: XmlLimits = {}): XmlObject {
  const maxDepth = limits.maxDepth ?? 100;
  const maxElements = limits.maxElements ?? 1_000_000;
  const src = input.charCodeAt(0) === 0xfeff ? input.slice(1) : input;
  const root = node();
  const stack: Frame[] = [];
  let elements = 0;
  let i = 0;

  const close = (f: Frame) => {
    const text = f.text.trim();
    let value: XmlNode;
    if (!f.hasChildren && !f.hasAttrs) value = text;
    else {
      if (text) f.obj["#text"] = text;
      value = f.obj;
    }
    const parent = stack.at(-1);
    if (parent) {
      parent.hasChildren = true;
      append(parent.obj, f.key, value);
    } else {
      if (Object.keys(root).length) throw new XmlError("XML birden fazla kök eleman içeriyor.", i);
      root[f.key] = value;
    }
  };

  while (i < src.length) {
    const lt = src.indexOf("<", i);
    const top = stack.at(-1);
    if (lt === -1) {
      if (src.slice(i).trim()) {
        if (!top) throw new XmlError("Kök eleman dışında metin var.", i);
        top.text += decodeEntities(src.slice(i));
      }
      break;
    }
    if (lt > i) {
      const chunk = src.slice(i, lt);
      if (top) top.text += decodeEntities(chunk);
      else if (chunk.trim()) throw new XmlError("Kök eleman dışında metin var.", i);
    }
    i = lt;
    if (src.startsWith("<!--", i)) {
      const end = src.indexOf("-->", i + 4);
      if (end === -1) throw new XmlError("Kapanmamış yorum.", i);
      i = end + 3;
    } else if (src.startsWith("<![CDATA[", i)) {
      const end = src.indexOf("]]>", i + 9);
      if (end === -1) throw new XmlError("Kapanmamış CDATA.", i);
      if (!top) throw new XmlError("Kök eleman dışında CDATA var.", i);
      top.text += src.slice(i + 9, end);
      i = end + 3;
    } else if (src.startsWith("<?", i)) {
      const end = src.indexOf("?>", i + 2);
      if (end === -1) throw new XmlError("Kapanmamış işlem talimatı.", i);
      i = end + 2;
    } else if (src.startsWith("<!", i)) {
      const end = src.indexOf(">", i);
      const decl = src.slice(i, end === -1 ? undefined : end);
      if (/<!ENTITY/i.test(decl) || decl.includes("[")) throw new XmlError("Güvenlik nedeniyle DOCTYPE / ENTITY tanımı içeren XML kabul edilmez.", i);
      if (end === -1) throw new XmlError("Kapanmamış bildirim.", i);
      i = end + 1;
    } else if (src[i + 1] === "/") {
      const end = src.indexOf(">", i);
      if (end === -1) throw new XmlError("Kapanmamış etiket.", i);
      const name = src.slice(i + 2, end).trim();
      const f = stack.pop();
      if (!f || f.name !== name) throw new XmlError(`Beklenmeyen kapanış etiketi: </${name}>`, i);
      close(f);
      i = end + 1;
    } else {
      // start tag: find its end outside quoted attribute values
      let j = i + 1, quote = "";
      for (; j < src.length; j++) {
        const ch = src[j]!;
        if (quote) { if (ch === quote) quote = ""; }
        else if (ch === '"' || ch === "'") quote = ch;
        else if (ch === ">") break;
      }
      if (j >= src.length) throw new XmlError("Kapanmamış etiket.", i);
      let body = src.slice(i + 1, j);
      const selfClosing = body.endsWith("/");
      if (selfClosing) body = body.slice(0, -1);
      const name = NAME.exec(body)?.[0];
      if (!name) throw new XmlError("Geçersiz etiket adı.", i);
      if (++elements > maxElements) throw new XmlError(`XML en fazla ${maxElements.toLocaleString("tr-TR")} eleman içerebilir.`, i);
      if (stack.length >= maxDepth) throw new XmlError(`XML en fazla ${maxDepth} seviye derin olabilir.`, i);
      const f: Frame = { name, key: limits.localNames ? name.slice(name.indexOf(":") + 1) : name, obj: node(), text: "", hasChildren: false, hasAttrs: false };
      const rest = body.slice(name.length);
      for (const m of rest.matchAll(ATTR)) {
        f.obj[`@${m[1]}`] = decodeEntities(m[3] ?? m[4] ?? "");
        f.hasAttrs = true;
      }
      if (selfClosing) close(f);
      else stack.push(f);
      i = j + 1;
    }
  }
  if (stack.length) throw new XmlError(`Kapanmamış etiket: <${stack.at(-1)!.name}>`, src.length);
  if (!Object.keys(root).length) throw new XmlError("XML boş.", 0);
  return root;
}
