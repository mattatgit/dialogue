const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs/promises');
const os = require('node:os');
const path = require('node:path');
const { conversationDir, sessionArgs, readReply, REPLY_LIMIT } = require('../server/conversation.js');

test('full replies preserve Markdown/code and never promote tools, thinking, interrupted or failed turns', async () => {
  const source = await fs.readFile(path.resolve(__dirname, '../omp/conversation.js'), 'utf8');
  const { finalReply } = await import(`data:text/javascript;base64,${Buffer.from(source).toString('base64')}`);
  const text = '**A complete answer**\n\n' + 'Detailed context. '.repeat(100) + '\n```js\nconst x = 1;\n```';
  const content = [{ type: 'thinking', text: 'private reasoning' }, { type: 'toolCall', name: 'read', arguments: { path: 'secret' } }, { type: 'text', text }];
  assert.deepEqual(finalReply({ role: 'assistant', stopReason: 'stop', content }), { state: 'complete', text, truncated: false });
  for (const stopReason of ['aborted', 'error', 'toolUse']) assert.equal(finalReply({ role: 'assistant', stopReason, content }), null);
  assert.equal(finalReply({ role: 'toolResult', stopReason: 'stop', content }), null);
  assert.equal(finalReply({ role: 'assistant', stopReason: 'stop', content: [{ type: 'thinking', text: 'secret' }] }), null);
  const big = finalReply({ role: 'assistant', stopReason: 'stop', content: [{ type: 'text', text: 'x'.repeat(REPLY_LIMIT + 1) }] });
  assert.equal(big.text.length, REPLY_LIMIT); assert.equal(big.truncated, true);
});

test('native conversation state is branch-specific, resumes after restart and refuses silent history loss', async t => {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), 'dialogue-conversation-')); t.after(() => fs.rm(root, { recursive: true, force: true }));
  const dir = conversationDir(root, 'o-app/main');
  assert.notEqual(dir, conversationDir(root, 'o-app/experiment'));
  assert.ok(!(await sessionArgs(dir)).includes('--continue'));
  await fs.writeFile(path.join(dir, 'native.jsonl'), '{}\n');
  assert.ok((await sessionArgs(dir, true)).includes('--continue'));
  await fs.rm(path.join(dir, 'native.jsonl'));
  await assert.rejects(sessionArgs(dir, true), /conversation is missing/);
});

test('reply reader bounds generated files and refuses symlinks, malformed or unsettled content', async t => {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), 'dialogue-reply-')); t.after(() => fs.rm(root, { recursive: true, force: true }));
  const dir = path.join(root, 'replies'); await fs.mkdir(dir); const file = path.join(dir, 'reply.json');
  await fs.writeFile(file, JSON.stringify({ state: 'complete', text: 'Whole reply.' }));
  assert.deepEqual(await readReply(file), { text: 'Whole reply.', truncated: false });
  await fs.writeFile(file, JSON.stringify({ state: 'working', text: 'Not complete.' })); assert.equal(await readReply(file), null);
  await fs.writeFile(file, 'x'.repeat(256 * 1024 + 1)); await assert.rejects(readReply(file), /too large/);
  const outside = path.join(root, 'private.json'); await fs.writeFile(outside, '{"state":"complete","text":"private"}'); await fs.rm(file); await fs.symlink(outside, file);
  await assert.rejects(readReply(file), /leaves its working copy/);
});
