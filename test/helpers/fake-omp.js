#!/usr/bin/env node
// Stand-in for `omp -p` in pipeline tests. FAKE_OMP_PLAN names a JSON file:
// an array with one step per invocation, { recipe?: string, exit?: number }.
// Every call is appended to <plan>.calls as JSON lines.
const fs = require('node:fs');
const path = require('node:path');

const plan = process.env.FAKE_OMP_PLAN;
// Readiness probes from AgentAuth: a stored credential and a live reply.
const argv = process.argv.slice(2);
if (argv[0] === 'token') {
  process.stdout.write('fake-token\n');
  process.exit(0);
}
if (/Reply with exactly: OK/.test(argv[argv.length - 1] || '')) {
  process.stdout.write('OK\n');
  process.exit(0);
}
const steps = JSON.parse(fs.readFileSync(plan, 'utf8'));
const counter = `${plan}.count`;
const index = fs.existsSync(counter) ? Number(fs.readFileSync(counter, 'utf8')) : 0;
fs.writeFileSync(counter, String(index + 1));

const args = process.argv.slice(2);
fs.appendFileSync(`${plan}.calls`, `${JSON.stringify({
  args,
  prompt: args[args.length - 1],
  cwd: process.cwd(),
  envFileVisible: fs.existsSync('.env'),
  agentEnv: process.env.FAKE_AGENT_ENV || null
})}\n`);

const step = steps[Math.min(index, steps.length - 1)] || {};
if (step.recipe !== undefined) {
  fs.mkdirSync('.dialogue', { recursive: true });
  fs.writeFileSync(path.join('.dialogue', 'preview.json'), step.recipe);
}
process.stdout.write(`fake agent step ${index}\n`);
process.exit(step.exit || 0);
