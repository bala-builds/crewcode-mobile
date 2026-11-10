import React from 'react';

/**
 * Structured-reply rendering for AI messages.
 * Small markdown subset on purpose: headings (#, ##, ###), bullet lists (- or *),
 * numbered lists (1. 2.), fenced code blocks (```), inline **bold** and `code`.
 * Anything else renders as plain paragraphs, so unformatted replies still read fine.
 */

export type Block =
  | { type: 'heading'; level: number; text: string }
  | { type: 'list'; ordered: boolean; items: string[] }
  | { type: 'code'; code: string }
  | { type: 'para'; text: string };

export function parseBlocks(text: string): Block[] {
  const lines = text.split('\n');
  const blocks: Block[] = [];
  let para: string[] = [];
  let list: { ordered: boolean; items: string[] } | null = null;
  const flushPara = () => { if (para.length) { blocks.push({ type: 'para', text: para.join('\n') }); para = []; } };
  const flushList = () => { if (list) { blocks.push({ type: 'list', ordered: list.ordered, items: list.items }); list = null; } };
  for (let i = 0; i < lines.length; i++) {
    const line = lines[i];
    if (line.trimStart().startsWith('```')) {
      flushPara(); flushList();
      const buf: string[] = [];
      i++;
      while (i < lines.length && !lines[i].trimStart().startsWith('```')) { buf.push(lines[i]); i++; }
      blocks.push({ type: 'code', code: buf.join('\n') });
      continue;
    }
    const h = /^(#{1,3})\s+(.+)$/.exec(line.trim());
    if (h) { flushPara(); flushList(); blocks.push({ type: 'heading', level: h[1].length, text: h[2].trim() }); continue; }
    const bullet = /^\s*[-*]\s+(.+)$/.exec(line);
    if (bullet) { flushPara(); if (!list || list.ordered) { flushList(); list = { ordered: false, items: [] }; } list.items.push(bullet[1]); continue; }
    const numbered = /^\s*\d+[.)]\s+(.+)$/.exec(line);
    if (numbered) { flushPara(); if (!list || !list.ordered) { flushList(); list = { ordered: true, items: [] }; } list.items.push(numbered[1]); continue; }
    if (line.trim() === '') { flushPara(); flushList(); continue; }
    flushList();
    para.push(line);
  }
  flushPara(); flushList();
  return blocks;
}

/** Inline **bold** and `code`. Plain, non-greedy, no nesting. */
export function renderInline(text: string): React.ReactNode[] {
  const out: React.ReactNode[] = [];
  const re = /(\*\*([^*]+)\*\*)|(`([^`]+)`)/g;
  let last = 0; let m: RegExpExecArray | null; let k = 0;
  while ((m = re.exec(text))) {
    if (m.index > last) out.push(text.slice(last, m.index));
    if (m[2] !== undefined) out.push(<strong key={k++}>{m[2]}</strong>);
    else out.push(<code key={k++} className="md-ic">{m[4]}</code>);
    last = m.index + m[0].length;
  }
  if (last < text.length) out.push(text.slice(last));
  return out;
}

export function Structured({ text }: { text: string }) {
  return (
    <div className="md">
      {parseBlocks(text).map((b, i) => {
        if (b.type === 'heading') return <div key={i} className={`md-h md-h${b.level}`}>{renderInline(b.text)}</div>;
        if (b.type === 'list') {
          const items = b.items.map((it, j) => <li key={j}>{renderInline(it)}</li>);
          return b.ordered ? <ol key={i} className="md-list">{items}</ol> : <ul key={i} className="md-list">{items}</ul>;
        }
        if (b.type === 'code') return <pre key={i} className="md-code"><code>{b.code}</code></pre>;
        return <div key={i} className="md-p">{renderInline(b.text)}</div>;
      })}
    </div>
  );
}
