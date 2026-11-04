// Branch-owned OMP state is durable; only this branch's session directory is
// mounted in its worker. The public transcript remains in request records.
const fs = require('node:fs/promises');
const path = require('node:path');
const { createHash } = require('node:crypto');
const { readProjectFile } = require('./project-files.js');
const REPLY_LIMIT = 32768;
function conversationDir(root, id) { return path.join(root, '.sessions', createHash('sha256').update(id).digest('hex')); }
function attachmentDir(root, id) { return path.join(root, '.attachments', createHash('sha256').update(id).digest('hex')); }
async function sessionArgs(dir, required = false) {
  await fs.mkdir(dir, { recursive: true, mode: 0o700 });
  const files = (await fs.readdir(dir, { withFileTypes: true })).filter(f => f.isFile() && f.name.endsWith('.jsonl'));
  if (required && !files.length) throw new Error('The saved agent conversation is missing. Restore its session data before continuing.');
  return ['--session-dir', dir, ...(files.length ? ['--continue'] : []), '--no-title', '--no-pty'];
}
async function readReply(file) {
  try {
    const value = JSON.parse((await readProjectFile(path.dirname(file), file, 256 * 1024)).toString('utf8'));
    if (value.state !== 'complete' || typeof value.text !== 'string' || value.text.length > REPLY_LIMIT || /[\u0000-\u0008\u000b-\u001f]/.test(value.text)) return null;
    return { text: value.text, truncated: value.truncated === true };
  } catch (error) { if (error.code === 'ENOENT' || error instanceof SyntaxError) return null; throw error; }
}
module.exports = { conversationDir, attachmentDir, sessionArgs, readReply, REPLY_LIMIT };
