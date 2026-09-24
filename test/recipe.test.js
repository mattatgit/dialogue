const test = require('node:test');
const assert = require('node:assert/strict');

const { guessStaticRecipe, parseRecipe } = require('../server/recipe.js');

test('parseRecipe fills defaults for a minimal static recipe', () => {
  const result = parseRecipe('{ "version": 1, "kind": "static", "root": "site" }');
  assert.deepEqual(result, {
    ok: true,
    recipe: { version: 1, kind: 'static', root: 'site', install: null, start: null, entry: '/', reload: 'dialogue', readyTimeoutSeconds: 120 }
  });
});

test('parseRecipe keeps server commands and normalises root', () => {
  const { recipe } = parseRecipe(JSON.stringify({ version: 1, kind: 'server', root: './web/', install: 'npm ci', start: 'npm run dev -- --port $PORT', entry: '/app', reload: 'self', readyTimeoutSeconds: 300 }));
  assert.equal(recipe.root, 'web');
  assert.equal(recipe.start, 'npm run dev -- --port $PORT');
  assert.equal(recipe.reload, 'self');
  assert.equal(recipe.readyTimeoutSeconds, 300);
});

test('parseRecipe rejects what Dialogue cannot run, naming the problem', () => {
  const bad = [
    ['not json', /JSON/],
    ['[]', /object/],
    ['{"version":2,"kind":"static"}', /version/],
    ['{"version":1,"kind":"docker"}', /kind/],
    ['{"version":1,"kind":"server"}', /start/],
    ['{"version":1,"kind":"static","root":"../outside"}', /root/],
    ['{"version":1,"kind":"static","root":"/etc"}', /root/],
    ['{"version":1,"kind":"static","entry":"index.html"}', /entry/],
    ['{"version":1,"kind":"static","reload":"sometimes"}', /reload/],
    ['{"version":1,"kind":"server","start":"x","readyTimeoutSeconds":0}', /readyTimeoutSeconds/],
    ['{"version":1,"kind":"server","start":"x","install":""}', /install/]
  ];
  for (const [text, message] of bad) {
    const result = parseRecipe(text);
    assert.equal(result.ok, false, text);
    assert.match(result.error, message, text);
  }
});

test('guessStaticRecipe picks prototypes/app, then the shallowest index.html', () => {
  const root = (paths) => JSON.parse(guessStaticRecipe(paths)).root;
  assert.equal(root(['README.md', 'docs/index.html', 'prototypes/app/index.html']), 'prototypes/app');
  assert.equal(root(['src/b/index.html', 'src/a/index.html', 'deep/er/x/index.html']), 'src/a');
  assert.equal(root(['index.html', 'app/index.html']), '.');
  assert.equal(parseRecipe(guessStaticRecipe(['index.html'])).ok, true);
});

test('guessStaticRecipe gives up when there is no page or the project has a package.json', () => {
  assert.equal(guessStaticRecipe(['README.md']), null);
  // A Vite-style index.html needs its dev server; leave those to the agent.
  assert.equal(guessStaticRecipe(['index.html', 'package.json', 'src/main.js']), null);
  assert.equal(guessStaticRecipe(['web/index.html', 'web/package.json']), null);
});
