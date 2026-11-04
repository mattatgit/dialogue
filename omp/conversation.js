import { promises as fs } from 'node:fs';
const LIMIT = 32768;
// Complete user-facing final prose only. Tool results, arguments and thinking
// never enter this channel, even if printed to stdout by another extension.
export function finalReply(message) {
  if (message?.role !== 'assistant' || message.stopReason !== 'stop' || !Array.isArray(message.content)) return null;
  const text = message.content.filter(p => p?.type === 'text' && typeof p.text === 'string').map(p => p.text).join('\n\n');
  if (!text.trim()) return null;
  return { state: 'complete', text: text.slice(0, LIMIT), truncated: text.length > LIMIT };
}
export default function(pi) {
  const file = process.env.DIALOGUE_REPLY_FILE;
  if (!file) return;
  pi.on('turn_end', async event => {
    if (event.toolResults?.length) return;
    const reply = finalReply(event.message);
    if (reply) await fs.writeFile(file, JSON.stringify(reply), { mode: 0o600 });
  });
}
