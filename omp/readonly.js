import fs from 'node:fs';
import path from 'node:path';
const allowed = new Set(['read', 'grep', 'glob']);
// --tools is a selection hint in the pinned CLI: its planning/transport
// machinery can add write again. Clamp the active set AND block execution.
// The worker also mounts source read-only and starts outside the repository,
// so project tool/extension discovery cannot execute code during assessment.
export default function(pi) {
  const source = fs.realpathSync(process.env.DIALOGUE_INSPECTION_ROOT);
  const attachments = process.env.DIALOGUE_READ_ATTACHMENTS && fs.realpathSync(process.env.DIALOGUE_READ_ATTACHMENTS);
  const design = process.env.DIALOGUE_READ_DESIGN && fs.realpathSync(process.env.DIALOGUE_READ_DESIGN);
  const roots = [source, attachments, design].filter(Boolean);
  const clamp = async (_event, ctx) => {
    if (typeof ctx.setActiveTools === 'function') await ctx.setActiveTools([...allowed]);
    else if (typeof pi.setActiveTools === 'function') await pi.setActiveTools([...allowed]);
    else throw new Error('The read-only tool policy could not be installed.');
  };
  pi.on('session_start', clamp);
  pi.on('before_agent_start', clamp);
  pi.on('tool_call', async event => {
    if (!allowed.has(event.toolName)) return { block: true, reason: 'This is a read-only assessment/discussion. Scripts, installs and edits require an agreed preparation or editing request.' };
    const requested = event.input?.path || event.input?.file_path || source;
    if (typeof requested !== 'string') return { block: true, reason: 'Inspect one source path at a time.' };
    const absolute = path.resolve(requested);
    const parts = absolute.split(path.sep);
    if (parts.some(p => /^\.env(?:\.|$)/.test(p) || ['.git', '.ssh', '.aws', '.omp'].includes(p))) return { block: true, reason: 'Private configuration is not available to the model.' };
    let real;
    try { real = fs.realpathSync(absolute); } catch { real = absolute; }
    if (!roots.some(root => real === root || real.startsWith(root + path.sep))) return { block: true, reason: `Read files only within the selected source at ${source}. Use absolute source paths.` };
    if (event.toolName === 'grep' && !fs.statSync(real, { throwIfNoEntry: false })?.isFile()) return { block: true, reason: 'Use glob to discover public source files, then search individual files. Directory-wide content search could include private configuration.' };
    const pattern = event.toolName === 'glob' ? event.input?.pattern : null;
    if (typeof pattern === 'string' && (pattern.split(/[\\/]/).includes('..') || path.isAbsolute(pattern) && !roots.some(root => pattern.startsWith(root + path.sep)))) return { block: true, reason: 'The file pattern must stay inside the selected source.' };
  });
}
