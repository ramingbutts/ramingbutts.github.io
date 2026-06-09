// Diag — lightweight observability layer for Personal OS.
//
// Applies the "build observable systems that explain themselves" principle to a
// static frontend: structured, centralized logging with an in-memory ring buffer
// so failures that used to be silent (localStorage quota, Supabase sync) become
// inspectable. Open the console and run `Diag.dump()` to see recent events, or
// `Diag.export()` to copy them out of the page.
const Diag = {
  _buf: [],
  _max: 200,
  _seen: {},

  _record(level, scope, message, detail) {
    const entry = { t: new Date().toISOString(), level, scope, message, detail };
    this._buf.push(entry);
    if (this._buf.length > this._max) this._buf.shift();
    const line = `[${scope}] ${message}`;
    if (level === 'error') console.error(line, detail ?? '');
    else if (level === 'warn') console.warn(line, detail ?? '');
    else console.info(line, detail ?? '');
    return entry;
  },

  log(scope, message, detail) { return this._record('info', scope, message, detail); },
  warn(scope, message, detail) { return this._record('warn', scope, message, detail); },
  error(scope, message, detail) { return this._record('error', scope, message, detail); },

  // Surface a problem to the user once per unique key, so a repeating failure
  // (e.g. every keystroke triggering a failed sync) doesn't spam toasts.
  notifyOnce(key, message, type = 'error') {
    if (this._seen[key]) return;
    this._seen[key] = true;
    if (typeof App !== 'undefined' && typeof App.toast === 'function') App.toast(message, type);
  },

  // Reset a notifyOnce key after the condition recovers, so the user is told
  // again if it breaks a second time.
  clearNotice(key) { delete this._seen[key]; },

  dump() { console.table(this._buf); return this._buf; },
  export() { return JSON.stringify(this._buf, null, 2); }
};
