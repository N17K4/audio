const { BrowserWindow } = require('electron');
const state = require('./state');
const http = require('http');

function openHealthCheckWindow(parentWin) {
  const url = `${state.backendBaseUrl}/health`;
  const win = new BrowserWindow({
    width: 520,
    height: 360,
    title: '健康检查',
    parent: parentWin,
    resizable: true,
    minimizable: false,
    maximizable: false,
  });
  win.setMenuBarVisibility(false);

  const loadingHtml = `<!DOCTYPE html><html><head><meta charset="utf-8"><style>
    body{margin:0;background:#1e1e1e;color:#d4d4d4;font:14px/1.6 "Menlo","Consolas",monospace;display:flex;align-items:center;justify-content:center;height:100vh}
    .url{color:#569cd6}
  </style></head><body><div>正在请求 <span class="url">${url}</span> …</div></body></html>`;
  win.loadURL('data:text/html;charset=utf-8,' + encodeURIComponent(loadingHtml));

  http.get(url, { timeout: 5000 }, (res) => {
    let body = '';
    res.on('data', chunk => { body += chunk; });
    res.on('end', () => {
      let pretty = body;
      try { pretty = JSON.stringify(JSON.parse(body), null, 2); } catch {}
      const escaped = pretty.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
      const statusColor = res.statusCode === 200 ? '#4ec9b0' : '#f48771';
      const html = `<!DOCTYPE html><html><head><meta charset="utf-8"><style>
        body{margin:0;background:#1e1e1e;color:#d4d4d4;font:13px/1.6 "Menlo","Consolas",monospace}
        .bar{padding:10px 16px;background:#252526;border-bottom:1px solid #3c3c3c;font-size:12px}
        .status{color:${statusColor};font-weight:bold}
        .url{color:#569cd6}
        pre{padding:16px;white-space:pre-wrap;word-break:break-all;margin:0}
      </style></head><body>
        <div class="bar">
          <span class="status">HTTP ${res.statusCode}</span>
          &nbsp;·&nbsp;<span class="url">${url}</span>
        </div>
        <pre>${escaped}</pre>
      </body></html>`;
      if (!win.isDestroyed()) win.loadURL('data:text/html;charset=utf-8,' + encodeURIComponent(html));
    });
  }).on('error', (err) => {
    const html = `<!DOCTYPE html><html><head><meta charset="utf-8"><style>
      body{margin:0;background:#1e1e1e;color:#f48771;font:13px/1.6 "Menlo","Consolas",monospace;padding:16px}
    </style></head><body><pre>请求失败：${err.message}\n\n地址：${url}</pre></body></html>`;
    if (!win.isDestroyed()) win.loadURL('data:text/html;charset=utf-8,' + encodeURIComponent(html));
  });
}

module.exports = {
  openHealthCheckWindow,
};
