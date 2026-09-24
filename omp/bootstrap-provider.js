// Loaded only by Dialogue's headless `omp --mode rpc` children (sign-in and
// catalog questions). omp refuses to start when no model is usable, which is
// exactly the state before the first sign-in; this placeholder provider
// makes one "usable" model exist without touching the user's models.yml.
// It points at a closed port and is never selected for real work.
export default function (pi) {
  pi.registerProvider('dialogue-bootstrap', {
    baseUrl: 'http://127.0.0.1:9/v1',
    apiKey: 'none',
    api: 'openai-completions',
    models: [{ id: 'bootstrap', name: 'Dialogue bootstrap', reasoning: false, input: ['text'], cost: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0 }, contextWindow: 8000, maxTokens: 1000 }]
  });
}
