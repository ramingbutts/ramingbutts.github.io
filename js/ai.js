// AI — optional local-LLM layer backed by Ollama (https://ollama.com).
//
// The dashboard stays a static site: when it's opened in a browser on a
// machine where Ollama is running (e.g. the Mac Mini), pages can ask a local
// model to analyze the data already in Storage. Nothing leaves the machine.
// When Ollama isn't reachable (phone, another device), features degrade to a
// toast pointing at the setup doc. Setup: docs/LOCAL-AI.md.
const AI = {
  BASE_URL: 'http://localhost:11434',
  MODEL: 'gpt-oss:20b', // ~13GB — comfortable on a 24GB M4 Pro Mac Mini

  _lastProbe: 0,
  _available: false,

  // Cheap reachability check against /api/tags, cached for 30s so repeated
  // clicks don't re-probe a dead endpoint.
  async available() {
    const now = Date.now();
    if (now - this._lastProbe < 30000) return this._available;
    this._lastProbe = now;
    try {
      const res = await fetch(`${this.BASE_URL}/api/tags`, { signal: AbortSignal.timeout(2000) });
      this._available = res.ok;
      if (!res.ok) Diag.warn('ai', `Ollama probe returned ${res.status}`);
    } catch (err) {
      this._available = false;
      Diag.warn('ai', 'Ollama not reachable', err);
    }
    return this._available;
  },

  // Streamed generation against /api/generate. onToken (optional) receives
  // (chunk, fullTextSoFar) as tokens arrive; resolves with the full text.
  // Callers own the user-facing error handling (Diag.error + toast).
  async generate(prompt, onToken) {
    Diag.log('ai', `generate via ${this.MODEL}`, { promptChars: prompt.length });
    const started = Date.now();
    const res = await fetch(`${this.BASE_URL}/api/generate`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ model: this.MODEL, prompt, stream: true })
    });
    if (!res.ok) throw new Error(`Ollama responded ${res.status}: ${await res.text()}`);

    const reader = res.body.getReader();
    const decoder = new TextDecoder();
    let buffer = '';
    let text = '';
    let evalCount = 0;
    while (true) {
      const { done, value } = await reader.read();
      if (done) break;
      buffer += decoder.decode(value, { stream: true });
      const lines = buffer.split('\n');
      buffer = lines.pop();
      for (const line of lines) {
        if (!line.trim()) continue;
        const chunk = JSON.parse(line);
        if (chunk.error) throw new Error(chunk.error);
        if (chunk.response) {
          text += chunk.response;
          if (onToken) onToken(chunk.response, text);
        }
        if (chunk.done) evalCount = chunk.eval_count || 0;
      }
    }
    const secs = (Date.now() - started) / 1000;
    Diag.log('ai', `generated ${evalCount} tokens in ${secs.toFixed(1)}s (${(evalCount / secs).toFixed(1)} tok/s)`);
    return text;
  }
};
