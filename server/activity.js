const fs = require('node:fs/promises');
const path = require('node:path');
const { createHash } = require('node:crypto');

function activityPath(root, workspaceId) {
  return path.join(root, `${createHash('sha256').update(workspaceId).digest('hex')}.json`);
}

async function readActivity(file) {
  try {
    const raw = await fs.readFile(file, 'utf8');
    if (raw.length > 4096) return null;
    const value = JSON.parse(raw);
    if (!value || !['working', 'complete'].includes(value.state) ||
        typeof value.text !== 'string' || value.text.length > 180 || /[\r\n\u0000-\u001f\u007f]/.test(value.text) ||
        typeof value.updatedAt !== 'string' || !Number.isFinite(Date.parse(value.updatedAt))) return null;
    return { state: value.state, text: value.text, updatedAt: value.updatedAt };
  } catch (error) {
    if (error.code === 'ENOENT' || error instanceof SyntaxError) return null;
    throw error;
  }
}

module.exports = { activityPath, readActivity };
