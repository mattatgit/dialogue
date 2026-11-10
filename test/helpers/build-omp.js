#!/usr/bin/env node
// Explicit mock for HTTP/UI flow tests. Real OMP/Deui is a separate check.
const fs = require('node:fs'), path = require('node:path');
const args = process.argv.slice(2), prompt = args.at(-1) || '';
if (args[0] === 'token') { console.log('disposable-test-token'); process.exit(0); }
if (prompt.includes('Reply with exactly: OK')) { console.log('OK'); process.exit(0); }
const assessment = args.includes('read,grep,glob');
if (assessment) {
  const result = { projectName: 'Imported fixture', assessment: 'This is a static Web fixture. Reuse its UI; no native integration was verified.', builds: [{ name: 'Web review', target: 'Web', root: '.', ref: 'main', approach: 'Reuse the existing UI', limitations: 'Fixture only', verification: {} }] };
  fs.writeFileSync(process.env.DIALOGUE_REPLY_FILE,JSON.stringify({state:'complete',text:JSON.stringify(result)}));
} else {
  const recipe = /ONLY at ([^\s]+)\./.exec(prompt)?.[1];
  if (recipe) { fs.mkdirSync(path.dirname(recipe),{recursive:true}); fs.writeFileSync(recipe,JSON.stringify({version:1,kind:'static',root:'.'})); }
  if (!fs.existsSync('index.html')) fs.writeFileSync('index.html','<!doctype html><h1>Created fixture</h1><button onclick="this.textContent=\'Charts\'">Show</button>');
  fs.writeFileSync(process.env.DIALOGUE_REPLY_FILE,JSON.stringify({state:'complete',text:'Prepared the disposable Web fixture. No remote repository was created or published.'}));
}
