/**
 * Asks the updater to restart into the installer it already verified.
 *
 * `quitAndInstall` refuses by throwing in the caller instead of emitting an
 * event, so an unguarded call loses the reason and the download along with it:
 * the installer stays in `pending/`, the window stays open and the interface
 * has nothing to say. The failure is returned rather than thrown so the handler
 * can keep the restart on offer.
 *
 * It lives here, apart from main.cjs, so both answers can be tested without
 * launching Electron.
 */
function restartFailure(updater) {
  try {
    updater.quitAndInstall(true, true);
    return null;
  } catch (error) {
    return String(error?.message ?? error);
  }
}

module.exports = {
  restartFailure,
};
