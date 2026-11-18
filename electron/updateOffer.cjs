/**
 * What an event from the updater does to the update state.
 *
 * The updater works on its own: a check eight seconds after launch, another
 * every six hours, and the one behind the settings button. Any of them can
 * answer while the verified installer sits in the `pending` folder waiting for
 * a restart, and any of them can fail the same way. None of those answers is
 * about the file already on disk, so a finished download survives them: the
 * restart stays, and the reason a check failed is kept beside it.
 *
 * Only two things replace it: an offer of a different version, which is a new
 * download to make, and a download that starts over.
 *
 * It lives here, apart from main.cjs, so the whole sequence can be tested
 * without launching Electron.
 */

function sameVersion(left, right) {
  return typeof left === 'string' && left.length > 0 && left === right;
}

function percentOf(value) {
  return Math.min(100, Math.max(0, Math.round(value ?? 0)));
}

/**
 * The state an `update-available` event leaves behind.
 *
 * An offer of the version already downloaded is not a new download: the file
 * is here and verified, so only the restart is missing. Any other offer is a
 * plain one, and a newer version replaces what waited.
 */
function nextStateForOffer(previous, info) {
  const offered = typeof info?.version === 'string' && info.version ? info.version : null;

  if (previous.status === 'downloaded' && sameVersion(previous.version, offered)) {
    return { ...previous, error: null };
  }

  return { ...previous, status: 'available', version: offered, percent: 0, error: null };
}

/**
 * The state an event leaves behind, in the order the updater emits them.
 */
function nextStateForEvent(state, event, payload) {
  const previous = state && typeof state === 'object' ? state : {};
  const waiting = previous.status === 'downloaded';

  switch (event) {
    case 'checking-for-update':
      return waiting ? { ...previous, error: null } : { ...previous, status: 'checking', error: null };

    case 'update-available':
      return nextStateForOffer(previous, payload);

    case 'update-not-available':
      return waiting
        ? { ...previous, error: null }
        : { ...previous, status: 'up-to-date', version: null, percent: 0, error: null };

    case 'download-progress':
      return { ...previous, status: 'downloading', percent: percentOf(payload?.percent) };

    case 'update-downloaded':
      return {
        ...previous,
        status: 'downloaded',
        version: payload?.version ?? previous.version,
        percent: 100,
        error: null,
      };

    case 'error': {
      const message = String(payload?.message ?? 'unknown error');
      // Whatever failed did not fail at fetching: a broken download is still
      // `downloading`. A finished one keeps its restart and records why.
      return waiting ? { ...previous, error: message } : { ...previous, status: 'error', error: message };
    }

    default:
      return previous;
  }
}

module.exports = {
  nextStateForEvent,
};
