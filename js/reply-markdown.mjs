const esc = value => String(value ?? '').replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
// Responses come from agent text: render only supported inline Markdown,
// escaping all other markup instead of treating it as trusted HTML.
function inlineMarkdown(value) {
  const text = String(value ?? '');
  const token = /\[([^\]\n]+)\]\((https?:\/\/[^\s)]+)\)|\*\*([^*\n]+)\*\*|__([^_\n]+)__|`([^`\n]+)`|~~([^~\n]+)~~|\*([^*\n]+)\*|_([^_\n]+)_/g;
  let html = '', position = 0;
  for (const match of text.matchAll(token)) {
    html += esc(text.slice(position, match.index));
    if (match[1]) {
      try {
        const url = new URL(match[2]);
        html += `<a href="${esc(url.href)}" target="_blank" rel="noopener noreferrer">${esc(match[1])}</a>`;
      } catch { html += esc(match[0]); }
    } else if (match[3] || match[4]) html += `<strong>${esc(match[3] || match[4])}</strong>`;
    else if (match[5]) html += `<code>${esc(match[5])}</code>`;
    else if (match[6]) html += `<del>${esc(match[6])}</del>`;
    else html += `<em>${esc(match[7] || match[8])}</em>`;
    position = match.index + match[0].length;
  }
  return html + esc(text.slice(position));
}

function listMarker(line) {
  const match = /^( *)([-+*]|\d{1,9}[.)])([ \t]+)(.*)$/.exec(line);
  if (!match) return null;
  const ordered = /^\d/.test(match[2]);
  return { indent: match[1].length, contentIndent: match[1].length + match[2].length + match[3].length,
    tag: ordered ? 'ol' : 'ul', start: ordered ? Number(match[2].slice(0, -1)) : 1, text: match[4] };
}
function fence(line) { return /^ {0,3}(`{3,}|~{3,})(.*)$/.exec(line); }

// Only generated block/inline tags enter the DOM. All model prose and code is
// escaped; list markers never become raw HTML or attributes supplied by text.
export function replyMarkdown(value) {
  return blocks(String(value ?? '').replace(/\r\n?/g, '\n').split('\n'));
}
function blocks(lines, depth = 0) {
  let html = '', i = 0;
  while (i < lines.length) {
    if (!lines[i].trim()) { i++; continue; }
    const code = fence(lines[i]);
    if (code) {
      const text = []; i++;
      while (i < lines.length) {
        const close = /^ {0,3}(`+|~+)\s*$/.exec(lines[i]);
        if (close && close[1][0] === code[1][0] && close[1].length >= code[1].length) { i++; break; }
        text.push(lines[i++]);
      }
      html += `<pre><code>${esc(text.join('\n'))}</code></pre>`;
      continue;
    }
    const first = depth < 32 && listMarker(lines[i]);
    if (first) {
      html += `<${first.tag}${first.tag === 'ol' && first.start !== 1 ? ` start="${first.start}"` : ''}>`;
      while (i < lines.length) {
        const item = listMarker(lines[i]);
        if (!item || item.indent !== first.indent || item.tag !== first.tag) break;
        const content = [item.text]; let blank = false; i++;
        while (i < lines.length) {
          if (!lines[i].trim()) { content.push(''); blank = true; i++; continue; }
          const indent = /^ */.exec(lines[i])[0].length;
          if (indent >= item.contentIndent) { content.push(lines[i++].slice(item.contentIndent)); continue; }
          if (listMarker(lines[i]) || fence(lines[i]) || blank) break;
          // Markdown permits a wrapped item line without repeating its indent.
          content.push(lines[i++].trimStart());
        }
        html += `<li>${blocks(content, depth + 1)}</li>`;
      }
      html += `</${first.tag}>`;
      continue;
    }
    const text = [lines[i++]];
    while (i < lines.length && lines[i].trim() && !fence(lines[i]) && !(depth < 32 && listMarker(lines[i]))) text.push(lines[i++]);
    html += `<p>${inlineMarkdown(text.join('\n').replace(/^#{1,6}\s+/gm, ''))}</p>`;
  }
  return html;
}
