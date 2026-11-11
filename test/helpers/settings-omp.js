#!/usr/bin/env node
// Explicit disposable Settings fixture. No real provider or credentials.
const args=process.argv.slice(2);
if(args[0]==='token'){console.log('fixture-token');process.exit(0);}
if(!args.includes('rpc')){console.log('OK');process.exit(0);}
const out=value=>process.stdout.write(JSON.stringify(value)+'\n');
const providers=[['openai-codex','ChatGPT'],['anthropic','Claude'],['openrouter','OpenRouter'],['github-copilot','Copilot'],['google-gemini-cli','Gemini']];
const models=[{provider:'openai-codex',id:'gpt-6.1-sol',name:'GPT-6.1 Sol'},{provider:'openai-codex',id:'gpt-6.1-mini',name:'GPT-6.1 Mini'},{provider:'anthropic',id:'claude-test',name:'Claude test'},{provider:'openrouter',id:'fixture',name:'Fixture'}];
const readline=require('node:readline').createInterface({input:process.stdin});
readline.on('line',line=>{const c=JSON.parse(line),reply=data=>out({type:'response',id:c.id,command:c.type,success:true,data});
 if(c.type==='get_login_providers')reply({providers:providers.map(([id,name])=>({id,name,authenticated:['openai-codex','anthropic'].includes(id)}))});
 else if(c.type==='get_available_models')reply({models});
 else if(c.type==='login')setTimeout(()=>reply({}),100);
 else reply({});
});
setImmediate(()=>out({type:'ready'}));
