const fs = require('node:fs');
const path = require('node:path');
const { EventEmitter } = require('node:events');
const { createHash } = require('node:crypto');
const { AgentAuth } = require('./agent-auth.js');

// Each account owns its model selection and OMP profile. The owner can retain
// the existing local profile; other members never inherit its API-key env.
class AccountAgents extends EventEmitter {
  constructor({ accounts, context, dataRoot, appRoot }) {
    super(); Object.assign(this, { accounts, context, dataRoot, appRoot }); this.agents = new Map();
  }
  current() { return this.forUser(this.context.getStore()?.user.id || this.accounts.ownerId); }
  forUser(id) {
    if (this.agents.has(id)) return this.agents.get(id);
    const owner = id === this.accounts.ownerId;
    const root = owner ? this.dataRoot : path.join(this.dataRoot, 'users', id);
    const env = { DIALOGUE_TMUX_SERVER: `dialogue-${createHash('sha256').update(root).digest('hex').slice(0, 16)}` };
    if (!owner) {
      const home = path.join(root, 'home'); fs.mkdirSync(home, { recursive: true, mode: 0o700 });
      for (const key of Object.keys(process.env)) if (/(?:API_KEY|API_TOKEN|ACCESS_TOKEN)$/.test(key) || /^(?:OMP_PROFILE|PI_PROFILE|PI_CODING_AGENT_DIR|OMP_CONFIG_DIR|XDG_CONFIG_HOME|XDG_DATA_HOME|XDG_CACHE_HOME)$/.test(key)) env[key] = '';
      Object.assign(env, { HOME: home, USERPROFILE: home, OMP_PROFILE: 'default', PI_PROFILE: 'default', PI_CODING_AGENT_DIR: path.join(home, '.omp', 'agent') });
    }
    const agent = new AgentAuth({ dataRoot: root, appRoot: this.appRoot, env });
    agent.on('ready', value => this.emit('ready', { userId: id, ...value }));
    agent.on('model', () => this.emit('model', id));
    this.agents.set(id, agent); return agent;
  }
  get model() { return this.current().model; }
  get defaultModel() { return this.current().defaultModel; }
  status() { return this.current().status(); }
  check(...args) { return this.current().check(...args); }
  ompArgs() { return this.current().ompArgs(); }
  ompEnv() { return this.current().ompEnv(); }
  shutdown() { for (const agent of this.agents.values()) agent.shutdown(); }
}
module.exports = { AccountAgents };
