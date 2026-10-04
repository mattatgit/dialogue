const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs/promises');
const os = require('node:os');
const path = require('node:path');
const { activityPath, readActivity } = require('../server/activity.js');

async function extension() {
  const source = await fs.readFile(path.join(__dirname, '../omp/activity.js'), 'utf8');
  return import(`data:text/javascript;base64,${Buffer.from(source).toString('base64')}`);
}

test('agent activity shares only a one-line final assistant answer, never tool output, reasoning, or credentials', async () => {
  const { finalSentence, toolLabel } = await extension();
  const secret = 'sk-test-abcdefghijklmnopqrstuvwxyz1234567890';
  const messages = [
    { role: 'toolResult', content: [{ type: 'text', text: `Tool output: ${secret}` }] },
    { role: 'assistant', content: [{ type: 'thinking', text: secret }, { type: 'text', text: 'Updated the navigation. The preview is ready.' }] }
  ];
  assert.equal(finalSentence(messages), 'Updated the navigation.');
  assert.equal(finalSentence([{ role: 'assistant', content: [{ type: 'text',
    text: 'Changed:\n- `prototypes/app/styles.css`\n  - Updated the PTT button to its original green color.\n\nVerification:\n- Checked the result in Chromium.' }] }]),
    'Updated the PTT button to its original green color.');
  assert.equal(toolLabel('bash'), 'Running a command');
  assert.equal(toolLabel(`bash ${secret}`), 'Working on the request');
  assert.equal(finalSentence([{ role: 'assistant', content: [{ type: 'text', text: `The token is ${secret}` }] }]),
    'The agent finished without a shareable summary.');
  assert.equal(finalSentence([{ role: 'assistant', content: [{ type: 'text', text: `Authorization: Bearer ${secret}` }] }]),
    'The agent finished without a shareable summary.');
  assert.equal(finalSentence([{ role: 'assistant', content: [{ type: 'text', text: `Updated: https://private.example/?access=${secret}` }] }]),
    'The agent finished without a shareable summary.');
  assert.equal(finalSentence([{ role: 'assistant', content: [{ type: 'text', text: 'Prior success.' }] },
    { role: 'assistant', stopReason: 'error', content: [] }]), 'The agent could not finish the request.');
  assert.equal(finalSentence([{ role: 'toolResult', content: [{ type: 'text', text: secret }] }]),
    'The agent finished without a summary.');
  assert.equal(finalSentence([{ role: 'assistant', content: [{ type: 'text', text: 'Earlier success.' }] },
    { role: 'toolResult', content: [{ type: 'text', text: 'latest tool output' }] }]),
    'The agent finished without a summary.');
});

test('agent sidecar remains private, bounded, branch-isolated, and settles on stop', async (t) => {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), 'dialogue-activity-'));
  t.after(() => fs.rm(root, { recursive: true, force: true }));
  const file = activityPath(path.join(root, 'private'), 'project/main');
  assert.notEqual(file, activityPath(path.join(root, 'private'), 'project/other'));
  const original = process.env.DIALOGUE_ACTIVITY_FILE;
  process.env.DIALOGUE_ACTIVITY_FILE = file;
  t.after(() => { if (original === undefined) delete process.env.DIALOGUE_ACTIVITY_FILE;
    else process.env.DIALOGUE_ACTIVITY_FILE = original; });
  const { default: register } = await extension();
  const handlers = {};
  register({ on(name, handler) { handlers[name] = handler; } });
  await handlers.agent_start();
  assert.equal((await readActivity(file)).state, 'working');
  await handlers.tool_execution_start({ toolName: 'read', args: { path: 'secret-key' }, intent: 'private key' });
  assert.equal((await readActivity(file)).text, 'Reading project files');
  assert.equal((await fs.readFile(file, 'utf8')).includes('secret-key'), false);
  assert.equal((await fs.stat(path.dirname(file))).mode & 0o777, 0o700);
  assert.equal((await fs.stat(file)).mode & 0o777, 0o600);
  await handlers.agent_end({ willContinue: true, messages: [] });
  assert.equal((await readActivity(file)).state, 'working');
  await handlers.turn_end({ message: { role: 'assistant', stopReason: 'toolUse', content: [{ type: 'text', text: 'Still working.' }] },
    toolResults: [] });
  assert.equal((await readActivity(file)).state, 'working', 'tool turns must not settle the status');
  await handlers.turn_end({ message: { role: 'assistant', stopReason: 'stop',
    content: [{ type: 'text', text: 'Finished the requested changes.' }] }, toolResults: [] });
  assert.equal((await readActivity(file)).text, 'Finished the requested changes.');
  await handlers.turn_start();
  assert.equal((await readActivity(file)).state, 'working', 'a subsequent turn resumes live status');
  await handlers.session_shutdown();
  assert.equal((await readActivity(file)).text, 'The agent session was stopped.');
  await handlers.agent_start();
  await handlers.agent_end({ messages: [{ role: 'assistant', content: [{ type: 'text', text: 'Finished the requested changes.' }] }] });
  const completed = await readActivity(file);
  assert.equal(completed.state, 'complete');
  assert.equal(completed.text, 'Finished the requested changes.');
  await handlers.session_shutdown();
  assert.deepEqual(await readActivity(file), completed, 'normal shutdown preserves the final answer');
  assert.deepEqual(await fs.readdir(path.dirname(file)), [path.basename(file)]);
  await fs.writeFile(file, JSON.stringify({ state: 'complete', text: 'x'.repeat(241), updatedAt: new Date().toISOString() }));
  assert.equal(await readActivity(file), null);
});
