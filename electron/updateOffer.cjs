/**
 * What an event from the updater does to the update state.
 *
 * Checks run on their own: once eight seconds after launch, and every six hours
 * after that. Any of them can report the version that is already downloaded,
 * and the verified installer is then sitting in the updater's `pending` folder
 * waiting for a restart. Taking the offer at face value would swap the restart
 * button for the download one and ask for the same 120 MB a second time, so a
 * download that belongs to the offered version survives the check.
 *
 * A check also announces itself before it answers, and that notice used to
 * erase the download: the offer that followed then had nothing to preserve, the
 * restart button turned back into a download button, and asking for the restart
 * was refused until the file was offered again. Both answers therefore leave a
 * finished download alone.
 *
 * It lives here, apart from main.cjs, so the whole sequence can be tested
 * without launching Electron.
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

/**
 * The state an event leaves behind, in the order the updater emits them.
 *
 * A finished download outranks the check: the file is verified on disk, so
 * neither "I am looking" nor "there is nothing to fetch" may take the restart
 * away. Anything else keeps the visible state moving the way it always did.
 */
function nextStateForEvent(state, event, payload) {
  const previous = state && typeof state === 'object' ? state : {};
  const holdsDownload = previous.status === 'downloaded';

  switch (event) {
    case 'checking-for-update':
      return holdsDownload ? { ...previous, error: null } : { ...previous, status: 'checking', error: null };

    case 'update-available':
      return nextStateForOffer(previous, payload);

    case 'update-not-available':
      return holdsDownload
        ? { ...previous, error: null }
        : { ...previous, status: 'up-to-date', version: null, percent: 0, error: null };

    case 'download-progress':
      return {
        ...previous,
        status: 'downloading',
        percent: Math.min(100, Math.max(0, Math.round(payload?.percent ?? 0))),
      };

    case 'update-downloaded':
      return {
        ...previous,
        status: 'downloaded',
        version: payload?.version ?? previous.version,
        percent: 100,
        error: null,
      };

    default:
      return previous;
  }
}

module.exports = {
  nextStateForEvent,
  nextStateForOffer,
};
