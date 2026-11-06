const { spawn } = require('node:child_process');

/** ShellExecuteEx reports a refused consent prompt with this Win32 error. */
const ERROR_CANCELLED = 1223;

/**
 * Starts `target` through electron-builder's elevate.exe and reports what
 * Windows answered.
 *
 * The helper is not called with `-w`, so it returns as soon as ShellExecuteEx
 * has created the elevated process, or as soon as the user refuses the consent
 * prompt. That answer is the only real outcome: a timer cannot stand in for it.
 * The previous four-second timeout answered "ok" while the prompt was still
 * open, so this window quit before the user could cancel and a refusal looked
 * exactly like a successful restart.
 */
function launchElevated({ elevatePath, target, log = () => {}, spawnImpl = spawn }) {
  return new Promise((resolve) => {
    let settled = false;
    const finish = (result) => {
      if (settled) return;
      settled = true;
      resolve(result);
    };

    let child;
    try {
      child = spawnImpl(elevatePath, [target], { stdio: 'ignore' });
    } catch (error) {
      log(`elevate spawn error ${error.message}`);
      finish({ ok: false, reason: 'spawn-failed', detail: error.message });
      return;
    }

    child.once('error', (error) => {
      log(`elevate spawn error ${error.message}`);
      finish({ ok: false, reason: 'spawn-failed', detail: error.message });
    });

    child.once('exit', (code, signal) => {
      log(`elevate exit ${code}${signal ? ` signal=${signal}` : ''}`);
      if (code === 0) {
        finish({ ok: true });
      } else if (code === ERROR_CANCELLED) {
        finish({ ok: false, reason: 'cancelled' });
      } else {
        finish({
          ok: false,
          reason: 'launch-failed',
          detail: signal ? `elevate.exe signal ${signal}` : `elevate.exe exit ${code}`,
        });
      }
    });
  });
}

module.exports = { ERROR_CANCELLED, launchElevated };
