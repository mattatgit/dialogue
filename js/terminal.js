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
    background: '#f8f8f8',
    foreground: '#171717',
    cursor: '#171717',
    cursorAccent: '#ffffff',
    selectionBackground: 'rgba(6,126,194,.20)',
    selectionInactiveBackground: 'rgba(6,126,194,.12)',
    black: '#171717',
    red: '#b13535',
    green: '#176e2e',
    yellow: '#8a5600',
    blue: '#067ec2',
    magenta: '#69469a',
    cyan: '#087c83',
    white: '#f8f8f8',
    brightBlack: '#606660',
    brightRed: '#b13535',
    brightGreen: '#176e2e',
    brightYellow: '#8a5600',
    brightBlue: '#067ec2',
    brightMagenta: '#69469a',
    brightCyan: '#087c83',
    brightWhite: '#ffffff'
  };

  function mount(host, workspaceId, hooks = {}) {
    const term = new Terminal({
      // A fixed-width face keeps xterm's character grid aligned.
      fontFamily: '"Space Mono", ui-monospace, monospace',
      fontSize: 12,
      lineHeight: 1.5,
      letterSpacing: 0,
      cursorBlink: false,
      cursorStyle: 'bar',
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
