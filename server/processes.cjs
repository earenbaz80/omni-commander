/**
 * The process list and the network adapters, both read through PowerShell.
 *
 * They are the slowest JSON answers the server gives: the queries are bounded
 * by a timeout and a row limit here, not in the file that registers routes.
 */

const fs = require('fs');
const path = require('path');
const os = require('os');
const http = require('http');
const net = require('net');
const { execFile } = require('child_process');
const { promisify } = require('util');

const execFileAsync = promisify(execFile);

function registerProcessRoutes(app, deps) {
  const { logDebug, powershellTimeoutMs = 60000 } = deps;
  const POWERSHELL_TIMEOUT_MS = powershellTimeoutMs;

  const PROCESS_LIST_TIMEOUT_MS = 180000;
  const PROCESS_LIST_LIMIT = 500;

  /** One `tasklist /fo csv` row: quoted fields, `""` escapes, commas inside quotes. */
  function parseCsvLine(line) {
    const fields = [];
    let field = '';
    let quoted = false;
    for (let i = 0; i < line.length; i++) {
      const char = line[i];
      if (quoted) {
        if (char === '"' && line[i + 1] === '"') {
          field += '"';
          i += 1;
        } else if (char === '"') {
          quoted = false;
        } else {
          field += char;
        }
      } else if (char === '"') {
        quoted = true;
      } else if (char === ',') {
        fields.push(field);
        field = '';
      } else {
        field += char;
      }
    }
    fields.push(field);
    return fields;
  }

  app.get('/api/net/adapters', (_req, res) => {
    // Only what this process can see. The default gateway needs a WMI query and is
    // left out rather than filled with a plausible-looking address.
    const adapters = [];
    for (const [name, addresses] of Object.entries(os.networkInterfaces())) {
      for (const entry of addresses || []) {
        if (entry.family !== 'IPv4' && entry.family !== 4) continue;
        adapters.push({ name, address: entry.address, netmask: entry.netmask, internal: entry.internal });
      }
    }
    res.set('Cache-Control', 'no-store');
    res.json(adapters);
  });

  app.get('/api/processes', async (_req, res) => {
    try {
      const windows = process.platform === 'win32';
      const { stdout } = windows
        ? await execFileAsync('tasklist.exe', ['/fo', 'csv', '/nh'], {
            timeout: PROCESS_LIST_TIMEOUT_MS,
            windowsHide: true,
            maxBuffer: 8 * 1024 * 1024,
          })
        : await execFileAsync('ps', ['-eo', 'pid=,comm=,rss='], { timeout: PROCESS_LIST_TIMEOUT_MS });

      const rows = [];
      for (const line of String(stdout).split(/\r?\n/)) {
        if (!line.trim()) continue;
        if (windows) {
          const [name, pid, , , memory] = parseCsvLine(line);
          rows.push({
            name,
            pid: Number(pid) || 0,
            memoryKb: Number(String(memory || '').replace(/[^0-9]/g, '')) || 0,
          });
        } else {
          const [pid, name, memoryKb] = line.trim().split(/\s+/, 3);
          rows.push({ name, pid: Number(pid) || 0, memoryKb: Number(memoryKb) || 0 });
        }
      }

      res.set('Cache-Control', 'no-store');
      res.json(rows.filter((row) => row.pid > 0).slice(0, PROCESS_LIST_LIMIT));
    } catch (e) {
      res.status(500).json({ error: e.message });
    }
  });
}

module.exports = { registerProcessRoutes };
