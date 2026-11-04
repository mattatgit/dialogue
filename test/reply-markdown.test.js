const test = require('node:test');
const assert = require('node:assert/strict');
const renderer = import('../js/reply-markdown.mjs');

test('numbered and bulleted replies become real lists with wrapping and preserved starting numbers', async () => {
  const { replyMarkdown } = await renderer;
  assert.equal(replyMarkdown('It:\n1. Captures the draft\n   in a Git commit.\n2. Pushes **the current branch**.\n\nAfterwards.'),
    '<p>It:</p><ol><li><p>Captures the draft\nin a Git commit.</p></li><li><p>Pushes <strong>the current branch</strong>.</p></li></ol><p>Afterwards.</p>');
  assert.equal(replyMarkdown('3) Third\n4) Fourth\n\n- One\n- Two'),
    '<ol start="3"><li><p>Third</p></li><li><p>Fourth</p></li></ol><ul><li><p>One</p></li><li><p>Two</p></li></ul>');
});

test('nested lists and paragraphs stay inside their parent item', async () => {
  const { replyMarkdown } = await renderer;
  assert.equal(replyMarkdown('- Parent\n  1. First child\n  2. Second child\n\n  More about the parent.\n- Sibling'),
    '<ul><li><p>Parent</p><ol><li><p>First child</p></li><li><p>Second child</p></li></ol><p>More about the parent.</p></li><li><p>Sibling</p></li></ul>');
});

test('fenced code keeps literal list markers and markup, including inside list items', async () => {
  const { replyMarkdown } = await renderer;
  assert.equal(replyMarkdown('```txt\n1. literal\n- <tag>\n```\n\n- Example:\n\n  ~~~js\n  const html = "<img>";\n  ~~~\n- Next'),
    '<pre><code>1. literal\n- &lt;tag&gt;</code></pre><ul><li><p>Example:</p><pre><code>const html = &quot;&lt;img&gt;&quot;;</code></pre></li><li><p>Next</p></li></ul>');
});

test('list formatting never admits raw HTML or executable links', async () => {
  const { replyMarkdown } = await renderer;
  const html = replyMarkdown('- <img src=x onerror=alert(1)>\n- [Run](javascript:alert(1))\n- **Bold** and `a < b` with [docs](https://example.com/?a=1&b=2)');
  assert.ok(!html.includes('<img'));
  assert.ok(!html.includes('href="javascript:'));
  assert.match(html, /&lt;img src=x onerror=alert\(1\)&gt;/);
  assert.match(html, /<strong>Bold<\/strong> and <code>a &lt; b<\/code>/);
  assert.match(html, /href="https:\/\/example.com\/\?a=1&amp;b=2"/);
  const deep = Array.from({ length: 80 }, (_, i) => '  '.repeat(i) + '- <script>').join('\n');
  assert.ok(!replyMarkdown(deep).includes('<script>'));
});
