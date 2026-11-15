/**
 * Restricted Markdown for school website pages.
 *
 * Supported: # / ## / ### headings, paragraphs, "- " bullet lists, "1. " numbered lists,
 * **bold**, *italic* and [links](target). Anything else — including any HTML — is plain
 * text. The parser returns a tree of plain values; the renderer turns it into React
 * elements, so no string is ever injected as HTML.
 *
 * Link targets allowed: https://, http://, mailto:, tel:, or a page address on the same
 * site (e.g. "admissions", "inquiry"). Everything else (javascript:, data:, //host …)
 * becomes plain text.
 */

export type Inline =
  | { type: 'text'; text: string }
  | { type: 'strong'; children: Inline[] }
  | { type: 'em'; children: Inline[] }
  | { type: 'link'; href: LinkTarget; children: Inline[] };

export type LinkTarget = { kind: 'external'; url: string } | { kind: 'page'; slug: string };

export type Block =
  | { type: 'heading'; level: 1 | 2 | 3; children: Inline[] }
  | { type: 'paragraph'; children: Inline[] }
  | { type: 'list'; ordered: boolean; items: Inline[][] };

const PAGE_SLUG = /^[a-z0-9](?:[a-z0-9-]{0,48}[a-z0-9])?$/;

export const parseLinkTarget = (raw: string): LinkTarget | null => {
  const t = raw.trim();
  if (/^https?:\/\/[^\s/]+\.[^\s]+$/i.test(t)) return { kind: 'external', url: t };
  if (/^mailto:[^\s@]+@[^\s@]+$/i.test(t)) return { kind: 'external', url: t };
  if (/^tel:\+?[0-9 -]{6,20}$/i.test(t)) return { kind: 'external', url: t.replace(/ /g, '') };
  if (PAGE_SLUG.test(t)) return { kind: 'page', slug: t };
  return null;
};

/** Inline parser: **bold**, *italic*, [text](target). Unmatched markers stay as text. */
export const parseInline = (src: string, depth = 0): Inline[] => {
  const out: Inline[] = [];
  let buf = '';
  const flush = () => {
    if (buf) out.push({ type: 'text', text: buf });
    buf = '';
  };
  let i = 0;
  while (i < src.length) {
    if (depth < 3 && src.startsWith('**', i)) {
      const end = src.indexOf('**', i + 2);
      if (end > i + 2) {
        flush();
        out.push({ type: 'strong', children: parseInline(src.slice(i + 2, end), depth + 1) });
        i = end + 2;
        continue;
      }
    }
    if (depth < 3 && src[i] === '*' && src[i + 1] !== '*' && src[i + 1] !== ' ') {
      const end = src.indexOf('*', i + 1);
      if (end > i + 1 && src[end - 1] !== ' ') {
        flush();
        out.push({ type: 'em', children: parseInline(src.slice(i + 1, end), depth + 1) });
        i = end + 1;
        continue;
      }
    }
    if (depth < 3 && src[i] === '[') {
      const close = src.indexOf('](', i + 1);
      const end = close === -1 ? -1 : src.indexOf(')', close + 2);
      if (close > i + 1 && end !== -1) {
        const href = parseLinkTarget(src.slice(close + 2, end));
        if (href) {
          flush();
          out.push({
            type: 'link',
            href,
            children: parseInline(src.slice(i + 1, close), depth + 1),
          });
          i = end + 1;
          continue;
        }
      }
    }
    buf += src[i];
    i++;
  }
  flush();
  return out;
};

export const parseMarkdown = (src: string): Block[] => {
  const blocks: Block[] = [];
  const lines = src.replace(/\r\n?/g, '\n').split('\n');
  let para: string[] = [];
  let list: { ordered: boolean; items: string[] } | null = null;

  const endPara = () => {
    if (para.length) blocks.push({ type: 'paragraph', children: parseInline(para.join(' ')) });
    para = [];
  };
  const endList = () => {
    if (list) {
      blocks.push({
        type: 'list',
        ordered: list.ordered,
        items: list.items.map((t) => parseInline(t)),
      });
    }
    list = null;
  };

  for (const raw of lines) {
    const line = raw.trimEnd();
    const heading = /^(#{1,3})\s+(.+)$/.exec(line);
    const bullet = /^\s*[-*]\s+(.+)$/.exec(line);
    const numbered = /^\s*\d{1,3}[.)]\s+(.+)$/.exec(line);
    if (!line.trim()) {
      endPara();
      endList();
    } else if (heading) {
      endPara();
      endList();
      blocks.push({
        type: 'heading',
        level: heading[1]!.length as 1 | 2 | 3,
        children: parseInline(heading[2]!.trim()),
      });
    } else if (bullet || numbered) {
      endPara();
      const ordered = Boolean(numbered);
      if (list && list.ordered !== ordered) endList();
      list ??= { ordered, items: [] };
      list.items.push((bullet ?? numbered)![1]!.trim());
    } else {
      endList();
      para.push(line.trim());
    }
  }
  endPara();
  endList();
  return blocks;
};
