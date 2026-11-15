import { describe, expect, it } from 'vitest';
import { parseInline, parseLinkTarget, parseMarkdown } from './markdown.js';

describe('restricted markdown', () => {
  it('parses headings, paragraphs and lists', () => {
    const blocks = parseMarkdown('# Title\n\nLine one\nline two\n\n- a\n- b\n1. c');
    expect(blocks.map((b) => b.type)).toEqual(['heading', 'paragraph', 'list', 'list']);
    expect(blocks[1]).toEqual({
      type: 'paragraph',
      children: [{ type: 'text', text: 'Line one line two' }],
    });
    expect(blocks[2]).toMatchObject({ ordered: false, items: [[{ text: 'a' }], [{ text: 'b' }]] });
    expect(blocks[3]).toMatchObject({ ordered: true });
  });

  it('parses bold, italic and safe links', () => {
    expect(parseInline('**Hi** *there* [form](inquiry)')).toEqual([
      { type: 'strong', children: [{ type: 'text', text: 'Hi' }] },
      { type: 'text', text: ' ' },
      { type: 'em', children: [{ type: 'text', text: 'there' }] },
      { type: 'text', text: ' ' },
      {
        type: 'link',
        href: { kind: 'page', slug: 'inquiry' },
        children: [{ type: 'text', text: 'form' }],
      },
    ]);
  });

  it('keeps HTML and dangerous links as plain text', () => {
    expect(parseMarkdown('<script>alert(1)</script>')).toEqual([
      { type: 'paragraph', children: [{ type: 'text', text: '<script>alert(1)</script>' }] },
    ]);
    for (const bad of [
      'javascript:alert(1)',
      'JaVaScRiPt:alert(1)',
      'data:text/html,x',
      '//evil.example',
      'vbscript:x',
      'https://',
    ]) {
      expect(parseLinkTarget(bad)).toBeNull();
      expect(parseInline(`[x](${bad})`).every((n) => n.type === 'text')).toBe(true);
    }
    expect(parseLinkTarget('https://school.example/fees')).toEqual({
      kind: 'external',
      url: 'https://school.example/fees',
    });
    expect(parseLinkTarget('tel:+91 98290 12345')).toEqual({
      kind: 'external',
      url: 'tel:+919829012345',
    });
    expect(parseLinkTarget('mailto:office@school.example')).toMatchObject({ kind: 'external' });
  });

  it('handles Hindi text and unmatched markers', () => {
    expect(parseMarkdown('## प्रवेश\n\n**अधूरा')).toEqual([
      { type: 'heading', level: 2, children: [{ type: 'text', text: 'प्रवेश' }] },
      { type: 'paragraph', children: [{ type: 'text', text: '**अधूरा' }] },
    ]);
  });
});
