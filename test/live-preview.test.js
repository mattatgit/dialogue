const test = require('node:test');
const assert = require('node:assert/strict');
const fsp = require('node:fs/promises');
const os = require('node:os');
const path = require('node:path');

const { LivePreviews } = require('../server/live-preview.js');
const { PreviewProxy } = require('../server/preview-proxy.js');

test('a workspace opened before setup finished starts its preview once the project gets a recipe', { timeout: 10000 }, async () => {
  const dir = await fsp.mkdtemp(path.join(os.tmpdir(), 'dialogue-live-'));
  await fsp.writeFile(path.join(dir, 'index.html'), 'hi');
  let recipe = null; // what the default branch carries, as setup would commit it
  const repo = { readRecipe: async () => (recipe ? { text: recipe, source: 'default' } : null) };
  const live = new LivePreviews({ proxy: new PreviewProxy(), previews: { available: false }, stampsRoot: dir, internalPort: 1 });
  const states = [];
  const release = await live.open('o-app/feature', { slug: 'o-app', ref: 'feature', dir, repo, isDefault: false, head: async () => null }, (payload) => states.push(payload.state));
  try {
    assert.equal(states.at(-1), 'no-recipe');
    recipe = '{"version":1,"kind":"static"}';
    await live.projectRecipeChanged('o-app');
    await new Promise((resolve) => setTimeout(resolve, 50));
    assert.equal(states.at(-1), 'ready');
  } finally {
    release();
    await live.shutdown();
    await fsp.rm(dir, { recursive: true, force: true });
  }
});
