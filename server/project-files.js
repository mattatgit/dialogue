// Open first, then verify the opened inode's path on Linux. A pre-open
// realpath check alone races against a worker changing directory symlinks.
const fs = require('node:fs/promises');
const { constants } = require('node:fs');
const path = require('node:path');
const inside = (file, root) => file === root || file.startsWith(root + path.sep);
async function openProjectFile(root, file) {
  const boundary = await fs.realpath(root);
  let handle;
  try {
    handle = await fs.open(file, constants.O_RDONLY | constants.O_NONBLOCK);
    const opened = await fs.realpath(process.platform === 'linux' ? `/proc/self/fd/${handle.fd}` : file);
    if (!inside(opened, boundary)) throw new Error('Project file leaves its working copy.');
    const stat = await handle.stat();
    if (!stat.isFile()) throw new Error('Project file is not a regular file.');
    return { handle, size: stat.size, file: opened };
  } catch (error) { await handle?.close(); throw error; }
}
async function readProjectFile(root, file, maxBytes = 65536) {
  const opened = await openProjectFile(root, file);
  try { return await readOpenedFile(opened, maxBytes); }
  finally { await opened.handle.close(); }
}
async function readOpenedFile(opened, maxBytes) {
    if (opened.size > maxBytes) throw new Error('Project file is too large.');
    const data = Buffer.alloc(maxBytes + 1);
    let length = 0;
    while (length < data.length) {
      const { bytesRead } = await opened.handle.read(data, length, data.length - length, length);
      if (!bytesRead) break;
      length += bytesRead;
    }
    if (length > maxBytes) throw new Error('Project file is too large.');
    return data.subarray(0, length);
}
module.exports = { openProjectFile, readProjectFile, readOpenedFile, inside };
