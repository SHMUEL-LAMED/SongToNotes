import type { ReactNode } from "react";

/**
 * A small, safe Markdown renderer for the assistant's replies: headings,
 * paragraphs, bullet and numbered lists, bold, italic, inline code, code
 * blocks and links (http/https only). Everything is built as React nodes,
 * so nothing the model writes is ever set as HTML.
 */

function inline(text: string, keyPrefix: string): ReactNode[] {
  const nodes: ReactNode[] = [];
  const pattern = /(\*\*[^*]+\*\*|`[^`]+`|\[[^\]]+\]\((https?:\/\/[^)\s]+)\)|\*[^*\n]+\*)/g;
  let cursor = 0;
  let match: RegExpExecArray | null;
  let index = 0;
  while ((match = pattern.exec(text))) {
    if (match.index > cursor) nodes.push(text.slice(cursor, match.index));
    const token = match[0];
    const key = `${keyPrefix}-${index += 1}`;
    if (token.startsWith("**")) nodes.push(<strong key={key}>{token.slice(2, -2)}</strong>);
    else if (token.startsWith("`")) nodes.push(<code key={key}>{token.slice(1, -1)}</code>);
    else if (token.startsWith("[")) {
      const label = token.slice(1, token.indexOf("]("));
      nodes.push(
        <a key={key} href={match[2]} target="_blank" rel="noreferrer noopener">
          {label}
        </a>,
      );
    } else nodes.push(<em key={key}>{token.slice(1, -1)}</em>);
    cursor = match.index + token.length;
  }
  if (cursor < text.length) nodes.push(text.slice(cursor));
  return nodes;
}

export function renderMarkdown(source: string): ReactNode[] {
  const lines = source.replace(/\r/g, "").split("\n");
  const out: ReactNode[] = [];
  let index = 0;
  let key = 0;
  const next = () => `md-${key += 1}`;
  while (index < lines.length) {
    const line = lines[index];
    if (!line.trim()) {
      index += 1;
      continue;
    }
    if (line.startsWith("```")) {
      const body: string[] = [];
      index += 1;
      while (index < lines.length && !lines[index].startsWith("```")) body.push(lines[index++]);
      index += 1;
      out.push(
        <pre key={next()} dir="ltr">
          <code>{body.join("\n")}</code>
        </pre>,
      );
      continue;
    }
    const heading = line.match(/^(#{1,4})\s+(.*)$/);
    if (heading) {
      const level = heading[1].length;
      const content = inline(heading[2], next());
      out.push(level <= 2 ? <h3 key={next()}>{content}</h3> : <h4 key={next()}>{content}</h4>);
      index += 1;
      continue;
    }
    if (/^\s*[-*•]\s+/.test(line)) {
      const items: ReactNode[] = [];
      while (index < lines.length && /^\s*[-*•]\s+/.test(lines[index])) {
        items.push(<li key={next()}>{inline(lines[index].replace(/^\s*[-*•]\s+/, ""), next())}</li>);
        index += 1;
      }
      out.push(<ul key={next()}>{items}</ul>);
      continue;
    }
    if (/^\s*\d+[.)]\s+/.test(line)) {
      const items: ReactNode[] = [];
      while (index < lines.length && /^\s*\d+[.)]\s+/.test(lines[index])) {
        items.push(<li key={next()}>{inline(lines[index].replace(/^\s*\d+[.)]\s+/, ""), next())}</li>);
        index += 1;
      }
      out.push(<ol key={next()}>{items}</ol>);
      continue;
    }
    // A paragraph runs until a blank line or a block of another kind.
    const paragraph: string[] = [];
    while (index < lines.length && lines[index].trim() && !/^(#{1,4}\s|```|\s*[-*•]\s|\s*\d+[.)]\s)/.test(lines[index])) {
      paragraph.push(lines[index]);
      index += 1;
    }
    const parts: ReactNode[] = [];
    paragraph.forEach((text, at) => {
      if (at > 0) parts.push(<br key={next()} />);
      parts.push(...inline(text, next()));
    });
    out.push(<p key={next()}>{parts}</p>);
  }
  return out;
}

/** Pulls the [[open:tool]] markers out of a reply: the text without them, and the tools. */
export function splitOpenMarkers(text: string): { text: string; tools: string[] } {
  const tools: string[] = [];
  const clean = text
    .replace(/\[\[open:([a-z-]+)\]\]/g, (_, id: string) => {
      if (!tools.includes(id)) tools.push(id);
      return "";
    })
    .replace(/\n{3,}/g, "\n\n")
    .trim();
  return { text: clean, tools: tools.slice(0, 2) };
}
