import { promises as fs } from 'node:fs';
export default function(pi) {
  const file = process.env.DIALOGUE_RUNNER_FILE;
  if (!file) return;
  pi.registerTool({ name:'dialogue_preview', label:'Dialogue preview', description:'Inspect the managed preview, or queue install/start/restart/stop after this reply. Never start a development server in bash; queued work runs after the agent releases its worker reservation.',
    parameters:{ type:'object', properties:{ operation:{type:'string',enum:['status','install','start','restart','stop']} },required:['operation'],additionalProperties:false },
    async execute(_id, {operation}) {
      const state = JSON.parse(await fs.readFile(file,'utf8'));
      if (operation !== 'status') { state.operation = operation; await fs.writeFile(file,JSON.stringify(state),{mode:0o600}); }
      return {content:[{type:'text',text:operation === 'status' ? JSON.stringify(state.status) : 'Queued with Dialogue. Finish your reply to release resources; the managed runner will apply this operation afterwards. Do not wait/poll for it or start a shell server.'}],details:{queued:operation !== 'status'}};
    }
  });
}
