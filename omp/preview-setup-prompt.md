Figure out how to show a live preview of this repository in a browser, and
describe it in `.dialogue/preview.json`. Dialogue reads that file and runs
the preview itself; you only write the file.

Format (JSON, all paths relative to the repository root):

{
  "version": 1,
  "kind": "static" | "server",
  "root": ".",
  "install": "npm ci",
  "start": "npm run dev -- --host 127.0.0.1 --port $PORT",
  "entry": "/",
  "reload": "dialogue" | "self",
  "readyTimeoutSeconds": 120
}

- "static": plain files that a browser can open as they are. "root" is the
  directory served; "entry" is the page to open (`/` means `index.html`).
  No "install"/"start".
- "server": anything that needs a build step or a dev server. "install"
  (optional) runs once per checkout and again when lockfiles change. "start"
  must keep running and serve HTTP on 127.0.0.1 at the port in `$PORT`; pass
  it explicitly with the tool's own flags, because many dev servers ignore
  the variable. "entry" must answer with a 2xx status once it is ready.
- "reload": "self" when the dev server reloads the page on changes itself
  (Vite, Next, webpack dev server...), else "dialogue".
- Prefer the project's own dev script and package manager (look at
  lockfiles). If there are several apps, pick the one a designer would
  review, usually the main web UI.
- The preview runs in every branch checkout, so "install" and "start" must
  not create or change files git would report (only git-ignored ones such
  as node_modules). With no lockfile, use e.g. `npm install
  --no-package-lock`; with one, `npm ci` (or the matching pnpm/yarn
  frozen-lockfile install).

You may inspect files and run commands to check your answer (for example
install dependencies and start the server briefly on a free port), but stop
anything you start. Do not change any other file and do not commit.
Reply with one sentence saying what you chose.
