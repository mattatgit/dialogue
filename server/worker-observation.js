// Private, attributed records. No argv, prompts, environment or credentials.
const fs = require('node:fs/promises');
const path = require('node:path');
function outcome({ code, signal, reason, oomKill = 0, result }) {
  if (reason === 'timeout' || result === 'timeout') return 'timeout';
  if (reason) return reason === 'cancelled' ? 'cancelled' : reason;
  if (oomKill > 0 || result === 'oom-kill') return 'memory-limit';
  return code === 0 ? 'completed' : signal ? 'signal' : 'exit-error';
}
function message(record) {
  const why = record.outcome;
  return why === 'memory-limit' ? `The ${record.kind} worker was killed for memory pressure (individual memory limit ${record.memoryMiB} MiB; aggregate budget ${record.budgetMiB} MiB).`
    : why === 'timeout' ? `The ${record.kind} worker reached its time limit.`
    : why === 'cancelled' ? `The ${record.kind} worker was cancelled.`
    : `The ${record.kind} worker stopped (${record.signal || (record.code ?? 'unknown')}); no memory-kill evidence was captured.`;
}
function noListenFilter(arch = process.arch) {
  const numbers = arch === 'x64' ? [0xc000003e, 49, 50] : arch === 'arm64' ? [0xc00000b7, 200, 201] : null;
  if (!numbers) throw new Error('Agent listener policy requires x64 or arm64 Linux.');
  const instructions = [[0x20,0,0,4], [0x15,1,0,numbers[0]], [6,0,0,0x80000000], [0x20,0,0,0], [0x35,0,1,0x40000000], [6,0,0,0x80000000]];
  for (const syscall of [...numbers.slice(1),425]) instructions.push([0x15,0,1,syscall], [6,0,0,0x50000 | 13]);
  instructions.push([6,0,0,0x7fff0000]);
  const bytes = Buffer.alloc(instructions.length * 8);
  instructions.forEach(([code,jt,jf,k],i) => { bytes.writeUInt16LE(code,i*8); bytes[i*8+2]=jt; bytes[i*8+3]=jf; bytes.writeUInt32LE(k,i*8+4); });
  return bytes;
}
async function sampleCgroup(root) {
  const read = name => fs.readFile(path.join(root, name),'utf8').then(s => s.trim());
  const [current,peak,events,swap] = await Promise.all(['memory.current','memory.peak','memory.events','memory.swap.current'].map(read));
  const counters = Object.fromEntries(events.split('\n').map(l => l.split(/\s+/)));
  return { currentBytes:Number(current), peakBytes:Number(peak), swapBytes:Number(swap), oomKill:Number(counters.oom_kill || 0), oom:Number(counters.oom || 0) };
}
module.exports = { outcome, message, noListenFilter, sampleCgroup };
