import { promises as fs } from 'node:fs';
import { basename, dirname, join } from 'node:path';
import { randomUUID } from 'node:crypto';

const TOOL_LABELS = Object.freeze({
  read: 'Reading project files', grep: 'Searching project files', glob: 'Finding project files',
  bash: 'Running a command', edit: 'Editing project files', write: 'Writing project files',
  task: 'Working on a task', web_search: 'Researching the request',
  browser: 'Checking the browser', eval: 'Working through the request'
});
const NO_SUMMARY = 'The agent finished without a shareable summary.';

export function toolLabel(name) {
  return TOOL_LABELS[name] || 'Working on the request';
}

// Only the final assistant message's prose is eligible. Never inspect tool
// results, arguments, reasoning, or older turns for a public summary.
export function finalSentence(messages) {
  const entries = Array.isArray(messages) ? messages : [];
  const last = entries.at(-1);
  // An earlier assistant turn followed by a tool result is not a final answer.
  if (last?.role !== 'assistant') return 'The agent finished without a summary.';
  if (last?.stopReason === 'error') return 'The agent could not finish the request.';
  if (last?.stopReason === 'aborted') return 'The request was stopped.';
  if (!last || !Array.isArray(last.content)) return 'The agent finished without a summary.';
  const prose = last.content.filter((part) => part?.type === 'text' && typeof part.text === 'string')
    .map((part) => part.text).join('\n').replace(/```[\s\S]*?```/g, ' ');
  const line = prose.split('\n').map((value) => value.trim().replace(/^#{1,6}\s*|^[-*]\s*/, ''))
    .find((value) => value && !/^[^.!?]{1,48}:$/.test(value) && !/^`[^`]+`[.:]?$/.test(value) &&
      !/\b(?:password|secret|token|api[_ -]?key|authorization|bearer|credential|private key|access=)\b/i.test(value) &&
      !/^(?:```|\{|\[|\$|>|https?:\/\/)/.test(value) &&
      !/\b(?:sk-[\w-]+|gh[pousr]_[\w-]+|(?:[A-Za-z0-9_-]+\.){2}[A-Za-z0-9_-]+)\b/.test(value));
  if (!line) return NO_SUMMARY;
  const sentence = line.replace(/`[^`]*`/g, 'the requested change')
    .replace(/https?:\/\/\S+/g, 'a link')
    .replace(/\b[A-Za-z0-9_+/-]{32,}\b/g, '[redacted]')
    .replace(/[\u0000-\u001f\u007f]+/g, ' ').replace(/\s+/g, ' ').trim()
    .match(/^.{1,180}?(?:[.!?](?=\s|$)|$)/)?.[0] || '';
  return sentence.trim().slice(0, 180) || NO_SUMMARY;
}

export async function writeActivity(file, state, text) {
  const directory = dirname(file);
  const temporary = join(directory, `.${basename(file)}.${randomUUID()}.tmp`);
  const activity = { state, text: text.slice(0, 180), updatedAt: new Date().toISOString() };
  await fs.mkdir(directory, { recursive: true, mode: 0o700 });
  try {
    await fs.writeFile(temporary, JSON.stringify(activity), { mode: 0o600 });
    await fs.rename(temporary, file);
  } finally {
    await fs.rm(temporary, { force: true });
  }
}

export default function (pi) {
  const file = process.env.DIALOGUE_ACTIVITY_FILE;
  if (!file) return;
  let pending = Promise.resolve();
  let working = false;
  const publish = (state, text) => {
    working = state === 'working';
    pending = pending.catch(() => {}).then(() => writeActivity(file, state, text));
    return pending;
  };
  pi.on('agent_start', () => publish('working', 'Working on your request'));
  pi.on('tool_execution_start', (event) => publish('working', toolLabel(event.toolName)));
  // Print mode does not emit agent_end; its final assistant turn still settles
  // the request. Ignore tool-use turns, which are followed by more agent work.
  pi.on('turn_end', (event) => {
    if (event.message?.role === 'assistant' && event.message.stopReason === 'stop' && !event.toolResults?.length) {
      return publish('complete', finalSentence([event.message]));
    }
  });
  pi.on('turn_start', () => {
    if (!working) return publish('working', 'Working on your request');
  });
  pi.on('agent_end', (event) => {
    if (!event.willContinue) return publish('complete', finalSentence(event.messages));
  });
  pi.on('session_shutdown', () => {
    if (working) return publish('complete', 'The agent session was stopped.');
  });
}
