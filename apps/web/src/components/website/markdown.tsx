import Link from 'next/link';
import type { ReactNode } from 'react';
import { parseMarkdown } from '@school-erp/validation';
import type { Block, Inline } from '@school-erp/validation';

/**
 * Renders restricted Markdown as React elements. Text is always passed as text (React
 * escapes it), and only links the parser approved become anchors.
 * `pageHref` maps a same-site page address to a URL.
 */
export function Markdown({
  source,
  pageHref,
}: {
  source: string;
  pageHref: (slug: string) => string;
}) {
  const inline = (nodes: Inline[]): ReactNode[] =>
    nodes.map((n, i) => {
      switch (n.type) {
        case 'text':
          return n.text;
        case 'strong':
          return <strong key={i}>{inline(n.children)}</strong>;
        case 'em':
          return <em key={i}>{inline(n.children)}</em>;
        case 'link':
          return n.href.kind === 'page' ? (
            <Link
              key={i}
              href={pageHref(n.href.slug)}
              className="font-medium text-brand-700 underline"
            >
              {inline(n.children)}
            </Link>
          ) : (
            <a
              key={i}
              href={n.href.url}
              rel="noopener noreferrer nofollow"
              target={n.href.url.startsWith('http') ? '_blank' : undefined}
              className="font-medium text-brand-700 underline"
            >
              {inline(n.children)}
            </a>
          );
      }
    });

  const block = (b: Block, i: number) => {
    switch (b.type) {
      case 'heading':
        return b.level === 1 ? (
          <h1 key={i} className="mt-2 text-3xl font-semibold tracking-tight text-slate-900">
            {inline(b.children)}
          </h1>
        ) : b.level === 2 ? (
          <h2 key={i} className="mt-8 text-xl font-semibold text-slate-900">
            {inline(b.children)}
          </h2>
        ) : (
          <h3 key={i} className="mt-6 text-lg font-semibold text-slate-900">
            {inline(b.children)}
          </h3>
        );
      case 'paragraph':
        return (
          <p key={i} className="mt-4 leading-7 text-slate-700">
            {inline(b.children)}
          </p>
        );
      case 'list': {
        const items = b.items.map((it, j) => <li key={j}>{inline(it)}</li>);
        return b.ordered ? (
          <ol key={i} className="mt-4 list-decimal space-y-1 pl-6 text-slate-700">
            {items}
          </ol>
        ) : (
          <ul key={i} className="mt-4 list-disc space-y-1 pl-6 text-slate-700">
            {items}
          </ul>
        );
      }
    }
  };

  return <div>{parseMarkdown(source).map(block)}</div>;
}
