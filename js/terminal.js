// Browser side of the Dialogue web terminal: xterm.js speaking ttyd's
// protocol through Dialogue's /ws/terminal/<workspace>/ws proxy.
//
//   client → server   '0' + input bytes | '1' + JSON {columns, rows} | '2' + JSON pause/resume
//   server → client   '0' + output bytes | '1' + title | '2' + JSON client preferences
//
// Exposes window.DialogueTerminal = { mount(host, workspaceId, hooks) }.
(() => {
  const TEXT_ENCODER = new TextEncoder();
  const MIN_BACKOFF = 1000;
  const MAX_BACKOFF = 8000;

  const THEME = {
    background: '#171717',
    foreground: '#f8f8f8',
    cursor: '#ccff00',
    cursorAccent: '#171717',
    selectionBackground: 'rgba(204,255,0,.25)',
    selectionInactiveBackground: 'rgba(204,255,0,.14)',
    black: '#272727',
    red: '#e5484d',
    green: '#17b239',
    yellow: '#f5a623',
    blue: '#8ec5ff',
    magenta: '#c8b6ff',
    cyan: '#8fd9a3',
    white: '#cdd1cd',
    brightBlack: '#6b706b',
    brightRed: '#ff6b70',
    brightGreen: '#3fd35f',
    brightYellow: '#ffc04d',
    brightBlue: '#b3d9ff',
    brightMagenta: '#dcd0ff',
    brightCyan: '#b5ecc4',
    brightWhite: '#ffffff'
  };

  function mount(host, workspaceId, hooks = {}) {
    const term = new Terminal({
      fontFamily: '"JetBrains Mono", ui-monospace, SFMono-Regular, Menlo, monospace',
      fontSize: 13,
      lineHeight: 1.45,
      letterSpacing: 0,
      cursorBlink: false,
      cursorStyle: 'block',
      allowProposedApi: true,
      allowTransparency: false,
      scrollback: 5000,
      macOptionIsMeta: true,
      theme: THEME
    });
    const fit = new FitAddon.FitAddon();
    term.loadAddon(fit);
    term.open(host);

    let socket = null;
    let backoff = MIN_BACKOFF;
    let closedByUs = false;
    let reconnectTimer = null;

    const wsUrl = () => {
      const protocol = window.location.protocol === 'https:' ? 'wss:' : 'ws:';
      return `${protocol}//${window.location.host}/ws/terminal/${workspaceId}/ws`;
    };

    const sendResize = () => {
      if (socket?.readyState !== WebSocket.OPEN) return;
      socket.send(TEXT_ENCODER.encode(`1${JSON.stringify({ columns: term.cols, rows: term.rows })}`));
    };

    const refit = () => {
      if (!host.isConnected || host.clientWidth === 0) return;
      fit.fit();
      sendResize();
    };

    const connect = () => {
      clearTimeout(reconnectTimer);
      hooks.onStatus?.('connecting');
      const ws = new WebSocket(wsUrl(), ['tty']);
      ws.binaryType = 'arraybuffer';
      socket = ws;

      ws.onopen = () => {
        backoff = MIN_BACKOFF;
        fit.fit();
        ws.send(TEXT_ENCODER.encode(JSON.stringify({ AuthToken: '', columns: term.cols, rows: term.rows })));
        hooks.onStatus?.('connected');
        term.focus();
      };

      ws.onmessage = (event) => {
        const data = new Uint8Array(event.data);
        if (!data.length) return;
        const type = String.fromCharCode(data[0]);
        if (type === '0') term.write(data.subarray(1));
        // '1' (title) and '2' (client prefs) are intentionally ignored.
      };

      ws.onclose = (event) => {
        if (socket !== ws) return;
        socket = null;
        if (closedByUs) return;
        if (event.code === 1011 && event.reason) {
          hooks.onStatus?.('error', event.reason);
          return;
        }
        hooks.onStatus?.('reconnecting', backoff);
        reconnectTimer = window.setTimeout(connect, backoff);
        backoff = Math.min(MAX_BACKOFF, backoff * 2);
      };

      ws.onerror = () => {};
    };

    term.onData((text) => {
      if (socket?.readyState !== WebSocket.OPEN) return;
      const bytes = TEXT_ENCODER.encode(text);
      const frame = new Uint8Array(bytes.length + 1);
      frame[0] = 0x30;
      frame.set(bytes, 1);
      socket.send(frame);
    });
    term.onBinary((binary) => {
      if (socket?.readyState !== WebSocket.OPEN) return;
      const frame = new Uint8Array(binary.length + 1);
      frame[0] = 0x30;
      for (let i = 0; i < binary.length; i += 1) frame[i + 1] = binary.charCodeAt(i) & 0xff;
      socket.send(frame);
    });
    term.onResize(sendResize);

    const observer = new ResizeObserver(() => refit());
    observer.observe(host);
    document.fonts?.ready.then(refit);

    connect();

    return {
      term,
      refit,
      focus: () => term.focus(),
      retry: () => {
        backoff = MIN_BACKOFF;
        connect();
      },
      dispose: () => {
        closedByUs = true;
        clearTimeout(reconnectTimer);
        observer.disconnect();
        socket?.close();
        term.dispose();
      }
    };
  }

  window.DialogueTerminal = { mount, THEME };
})();
