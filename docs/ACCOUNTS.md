# Accounts and the shared workspace

## Scope

`codex/accounts-shared-workspace` adds invitation-only Dialogue accounts to the existing integration build. The first release has one shared workspace, with an owner and editors. Every member can see its connected repositories, previews and project history; only the owner manages membership or removes a project. Personal workspaces, per-project visibility and public sharing are not implemented.

A Dialogue account is separate from the AI-provider login. Named apps/sites/prototypes and live editing-presence badges remain the next product step. The current Git branch/worktree gallery is retained.

## Sign-in and account storage

Passkeys are the everyday sign-in option; verified email codes provide initial enrollment and recovery. There are no Dialogue passwords. Existing email addresses are invited by the owner, and unverified editor invitations expire after 14 days. Reinviting renews a pending invitation. Creating an invitation does not send an unsolicited email: share the Dialogue address, and the recipient requests their own code.

Email codes expire after ten minutes, allow five attempts, are single-use and are HMAC-hashed at rest. Issuance and verification have persistent rate limits. Responses do not disclose invitation status, including when delivery fails. Production mail uses Nodemailer with TLS, certificate validation and bounded connection timeouts. Development/test mail is written to private files and never sent.

Passkey verification uses pinned `@simplewebauthn/server`. Registration is bound to a recently authenticated session, account, one-use challenge, exact origin and RP hostname; user verification is required. Authentication verifies the challenge, origin, RP, signature and counter. Changing a passkey after ten minutes requires reauthentication; the sign-in page supports that while a session is already valid.

`.dialogue-data/accounts.sqlite` holds users, the shared workspace, memberships, hashed sessions, challenges, rate limits, passkey public keys and working-copy reservations. It uses transactions, foreign keys and owner-only file permissions. Bootstrap runs once: restarting must not restore a removed member. Existing `db.json`, Git mirrors and worktrees are preserved. Sessions last 30 days and survive ordinary server restarts. Logout revokes the current session; removing a member revokes all their sessions and stops their active agent/terminal access.

Production session cookies use `__Host-`, Secure, HttpOnly, SameSite=Lax and no Domain attribute. The configured app Host and request Origin are checked. Mutating APIs require same-origin JSON requests. Protected pages redirect to sign-in; APIs, SSE and terminal upgrades enforce membership on the server. Long-lived connections are closed on revocation and checked for expiry.

Preview origins do not receive the account cookie. Browser preview URLs are separate, random capabilities bound to the requesting session and membership. They expire with that session and are revoked on logout/member removal; possession allows viewing while the session is valid, so they are not public share links. Internal screenshot origins and request-scoped Figma capabilities retain their existing narrowly scoped roles.

## Local development

1. Run `npm ci` after checking out this branch (or use the packaged Nix build).
2. Copy `.env.example` to `.env` if needed. Keep `.env` private and out of Git.
3. Set `DIALOGUE_MODE=development`, a loopback `DIALOGUE_ORIGIN` such as `http://localhost:4173`, `DIALOGUE_OWNER_EMAIL`, `DIALOGUE_OWNER_NAME`, optional comma-separated `DIALOGUE_INITIAL_MEMBERS`, and `DIALOGUE_WORKSPACE_NAME`.
4. Start normally inside the Nix devshell. Use the exact configured URL; the app redirects other page hosts to it.
5. Use the explicitly labelled development account buttons. Settings also allows switching between configured local identities, without an inbox or biometric prompt. These are real sessions and use normal authorization.

Development identities require an explicit development mode, a loopback listener and loopback origin, and refuse to start under `NODE_ENV=production`. There is no general auth-disabled mode or production test-login route. Test mode does not expose the development sign-in route. Local email messages are private files under `.dialogue-data/mail/`; no web endpoint exposes that mailbox.

`dev` uses `http://localhost:8080` by default, sets its public account origin, and preserves it through `browser-sync.config.cjs`. Previews still go directly to the upstream preview port. `npm start` uses the origin in `.env`.

Local passkeys belong to the local RP hostname. Enroll passkeys again on the final deployment hostname; local credentials are not deployment credentials. Production hostname and mail delivery remain unconfigured until chosen.

## Per-person AI connections and working copies

The existing integration owner retains their local OMP profile and saved model. Other members receive separate OMP homes, model settings and tmux servers under `.dialogue-data/users/<user-id>/`; inherited provider API-key variables are cleared for them. Provider login state and login streams are scoped to the signed-in person. Structured requests record their actor. Preview setup uses the requesting member's model; older projects without that attribution use the owner.

Before an agent, terminal, version save or other working-copy mutation starts, that working copy is reserved to an editor. Another member can view it read-only and work on a different copy in the same repository. An owner or the reserving editor can release it from Settings. Release refuses while a structured request, version save or preview setup is running; it closes the terminal while keeping file changes. Terminal reconnects cannot silently reclaim a released copy. Removing a member also retires their reserved terminals, including persistent tmux sessions.

These reservations are explicit working-copy ownership, **not live presence**. They do not yet implement the proposed automatic unit-level lease or avatar badge. Git branches also remain distinct from the planned named app/site/prototype identities.

Separate credential homes prevent accidental reuse through Dialogue's routing; they are not OS security isolation. Agents and project preview/install processes still run as the service user and need process/filesystem isolation before a broader production deployment. Authentication alone does not make arbitrary repository code safe.

## Production configuration

Use `DIALOGUE_MODE=production`, `NODE_ENV=production` and an exact HTTPS `DIALOGUE_ORIGIN`. Configure the owner/member emails, `DIALOGUE_SMTP_URL` (SMTP with required STARTTLS or SMTPS), and `DIALOGUE_MAIL_FROM` in the deployment's private environment file. Production refuses missing origin, owner or mail settings. Mail credentials are captured and removed from the environment before launching child processes.

The Nix package installs pinned npm dependencies with a fixed dependency hash. The NixOS module defaults to production and exposes `publicOrigin`; `development` is an explicit loopback-only demo option. Keep preview DNS/TLS, backups, process isolation and real email/passkey device verification on the deployment checklist. Do not expose the developer server publicly.

## Testing

Run the complete `npm test` suite. `test/helpers/account-fixture.js` creates disposable users and real sessions directly in isolated temporary databases; it does not add an HTTP bypass. Existing model-login and preview tests now run authenticated. Tests use distinct identities for owner/editor checks and normal permission enforcement.

Account tests cover persistent sessions, logout/removal, code hashing/attempts/expiry/rate limits, invitation-only access, denied page/API/SSE/terminal access, Origin checks, production/development boundaries, model-profile separation, independent editing within a repository, and preview revocation. A software authenticator generates real ES256 registrations/signatures to exercise passkey verification, replay rejection, RP/origin checks and user verification without biometric prompts. This does not replace the small real-device Safari passkey enrollment/login check before deployment. No real sign-in emails are sent by the tests.
