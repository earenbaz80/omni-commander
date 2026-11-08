/**
 * What an offer from the feed does to the update state.
 *
 * Checks run on their own: once eight seconds after launch, and every six hours
 * after that. Any of them can report the version that is already downloaded,
 * and the verified installer is then sitting in the updater's `pending` folder
 * waiting for a restart. Taking the offer at face value would swap the restart
 * button for the download one and ask for the same 120 MB a second time, so a
 * download that belongs to the offered version survives the check.
 *
 * It lives here, apart from main.cjs, so the decision can be tested without
 * launching Electron.
 */

function sameVersion(left, right) {
  return typeof left === 'string' && left.length > 0 && left === right;
}

/**
 * The state an `update-available` event leaves behind.
 *
 * Anything other than "the offered version is the downloaded one" is a plain
 * offer: a newer version replaces the pending download, and a check that finds
 * nothing downloaded reports what can be fetched.
 */
function nextStateForOffer(state, info) {
  const previous = state && typeof state === 'object' ? state : {};
  const offered = typeof info?.version === 'string' && info.version ? info.version : null;

  if (previous.status === 'downloaded' && sameVersion(previous.version, offered)) {
    // The file is here and verified: only the restart is missing.
    return { ...previous, status: 'downloaded', version: previous.version, percent: 100, error: null };
  }

  return { ...previous, status: 'available', version: offered, percent: 0, error: null };
}

module.exports = {
  nextStateForOffer,
};
