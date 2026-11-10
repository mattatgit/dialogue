const fsp = require('node:fs/promises');
const path = require('node:path');
const { parseRecipe } = require('./recipe.js');
const { CatalogError } = require('./catalog.js');
async function verifyBuild({ workers, live, proxy, port, previews, dataRoot, check }, build, workspace, repo, run) {
  const found = await repo.readRecipe(workspace.dir), parsed = found && parseRecipe(found.text);
  if (!parsed?.ok) throw new CatalogError(409, parsed?.error || 'Preview recipe is missing.');
  if (parsed.recipe.root !== build.root) throw new CatalogError(409, 'The recipe root differs from the approved application root. Review the plan before running it.');
  const release = await live.open(workspace.id, { slug: build.storageSlug, projectId: build.projectId, buildId: build.id, ref: workspace.ref, dir: workspace.dir, repo, isDefault: false }, () => {});
  const cleanup = async () => { release(); if (!live.entries.get(workspace.id)?.listeners.size) await live.close(workspace.id); };
  run.release = cleanup;
  try {
    const entry = live.entries.get(workspace.id); await entry.runner?.starting;
    check(run);
    if (entry.runner?.state !== 'ready') throw new Error(entry.problem?.message || entry.runner?.error?.message || 'The preview did not become ready.');
    const verification = build.verification || {};
    if (!verification.clickText || !verification.expectedText || !previews.available) return { previewConfigured: true, uiVerified: false, verificationOutstanding: 'Preview configured. A representative UI interaction still needs verification.' };
    const { previewBrowser, until } = require('./browser-driver.js');
    const { randomUUID } = require('node:crypto');
    const dir = path.join(dataRoot, 'workers', 'ui-checks', randomUUID()); await fsp.mkdir(dir, { recursive: true, mode: 0o700 });
    run.verificationAbort = new AbortController();
    const browser = await previewBrowser(workers, dir, { project: build.projectId, build: build.id, workspace: workspace.id, phase: 'import-ui-verification' }, run.verificationAbort.signal);
    try {
      await browser.navigate(`http://${proxy.tokenFor(workspace.id)}.preview.localhost:${port}${parsed.recipe.entry}`);
      await until(async () => { check(run); return browser.evaluate(`Boolean([...document.querySelectorAll('button,a,[role="button"]')].find(e => e.textContent.trim() === ${JSON.stringify(verification.clickText)}))`); });
      await browser.evaluate(`(() => { const e = [...document.querySelectorAll('button,a,[role="button"]')].find(e => e.textContent.trim() === ${JSON.stringify(verification.clickText)}); if (!e) throw Error('Interaction control disappeared'); e.click(); })()`);
      await until(async () => { check(run); return browser.evaluate(`Boolean(document.body?.innerText.includes(${JSON.stringify(verification.expectedText)}))`); });
      await browser.screenshot(path.join(dir, 'verified.png'));
      return { previewConfigured: true, uiVerified: true, verification: { ...verification, sourceSha: workspace.head.sha, draftTree: await repo.draftTree(workspace), branch: workspace.ref, checkedAt: new Date().toISOString() }, verificationOutstanding: null };
    } finally { await browser.close().catch(() => {}); run.verificationAbort = null; }
  } finally { await cleanup(); run.release = null; }
}

module.exports = { verifyBuild };
