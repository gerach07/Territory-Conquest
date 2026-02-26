#!/usr/bin/env node

/**
 * Territory Conquest - Dev Start Script
 * Checks ports, then starts server + React client via concurrently
 */

const { exec, spawn } = require('child_process');
const { promisify } = require('util');
const execAsync = promisify(exec);
const os = require('os');

const PORTS = { client: 3000, server: 3001 };

const c = {
  reset: '\x1b[0m', bright: '\x1b[1m',
  red: '\x1b[31m', green: '\x1b[32m', yellow: '\x1b[33m', cyan: '\x1b[36m', white: '\x1b[37m',
};

function log(msg, color) { color = color || c.white; console.log(color + msg + c.reset); }

function banner() {
  log('\n' + '='.repeat(56), c.cyan);
  log('  \uD83C\uDFF4  TERRITORY CONQUEST DEV SERVER', c.bright + c.cyan);
  log('='.repeat(56) + '\n', c.cyan);
}

async function checkPort(port) {
  try {
    if (os.platform() === 'win32') {
      var result = await execAsync('netstat -ano | findstr :' + port + ' | findstr LISTENING');
      var pids = result.stdout.trim().split('\n')
        .map(function (l) { return l.trim().split(/\s+/).pop(); })
        .filter(Boolean);
      return pids.length > 0 ? pids : null;
    } else {
      var result = await execAsync('lsof -ti:' + port + ' 2>/dev/null || echo ""');
      var pids = result.stdout.trim().split('\n').filter(Boolean);
      return pids.length > 0 ? pids : null;
    }
  } catch (e) { return null; }
}

async function killProcesses(pids) {
  try {
    if (os.platform() === 'win32') {
      for (var i = 0; i < pids.length; i++) {
        await execAsync('taskkill /F /PID ' + pids[i]).catch(function () {});
      }
    } else {
      await execAsync('kill -9 ' + pids.join(' '));
    }
    log('  \u2713 Cleaned up old processes', c.green);
    return true;
  } catch (e) {
    log('  \u2717 Failed to kill processes: ' + e.message, c.red);
    return false;
  }
}

async function startServer() {
  banner();

  for (var name in PORTS) {
    var port = PORTS[name];
    log('\uD83D\uDD0D Checking port ' + port + ' (' + name + ')...', c.cyan);
    var pids = await checkPort(port);
    if (pids) {
      log('  \u26A0\uFE0F  Port ' + port + ' in use (' + pids.length + ' process' + (pids.length > 1 ? 'es' : '') + ')', c.yellow);
      log('  \uD83D\uDD27 Auto-cleaning...', c.cyan);
      await killProcesses(pids);
      await new Promise(function (r) { setTimeout(r, 500); });
      var still = await checkPort(port);
      if (still) {
        log('\n  \u2717 Port ' + port + ' still in use. Close it manually.', c.red);
        process.exit(1);
      }
      log('  \u2713 Port ' + port + ' is now free\n', c.green);
    } else {
      log('  \u2713 Port ' + port + ' is available\n', c.green);
    }
  }

  log('\uD83D\uDE80 Starting development servers...\n', c.cyan);
  log('  Server: http://localhost:' + PORTS.server, c.cyan);
  log('  Client: http://localhost:' + PORTS.client + '\n', c.cyan);

  var dev = spawn('npm', ['run', 'dev:internal'], {
    stdio: 'inherit',
    shell: true,
    cwd: __dirname,
  });

  dev.on('error', function (error) {
    log('\n\u274C Failed to start: ' + error.message, c.red);
    process.exit(1);
  });

  dev.on('exit', function (code) {
    if (code !== 0 && code !== 130) {
      log('\n\u26A0\uFE0F  Server exited with code ' + code, c.yellow);
    }
    process.exit(code);
  });

  process.on('SIGINT', function () {
    log('\n\n\uD83D\uDC4B Shutting down gracefully...', c.cyan);
    dev.kill('SIGINT');
  });
  process.on('SIGTERM', function () { dev.kill('SIGTERM'); });
}

startServer().catch(function (err) {
  log('\n\u274C Unexpected error: ' + err.message, c.red);
  console.error(err);
  process.exit(1);
});
