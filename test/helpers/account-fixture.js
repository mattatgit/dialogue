// Creates real sessions in a disposable test database, without an auth bypass.
const { Accounts, accountConfig } = require('../../server/accounts.js');
function seedAccounts(dataRoot, port, email = 'owner@example.test') {
  const origin = `http://127.0.0.1:${port}`;
  const env = { DIALOGUE_MODE: 'test', DIALOGUE_ORIGIN: origin, DIALOGUE_OWNER_EMAIL: 'owner@example.test', DIALOGUE_OWNER_NAME: 'Test owner', DIALOGUE_INITIAL_MEMBERS: 'editor@example.test', HOST: '127.0.0.1', PORT: String(port) };
  const accounts = new Accounts({ dataRoot, config: accountConfig(env), sendMail: async () => {} });
  const user = accounts.members().find(member => member.email === email);
  accounts.db.prepare('UPDATE users SET verified=1 WHERE id=?').run(user.id);
  const raw = accounts.createSession(user.id);
  accounts.close();
  return { env, headers: { Cookie: `dialogue-session=${raw}`, Origin: origin, 'Content-Type': 'application/json' } };
}
module.exports = { seedAccounts };
