#!/usr/bin/env bash
#
# Sourced by the clean-container smokes, never run on its own.
#
# A container's apt has no reason to hang for the length of a job: a mirror that
# stopped answering and a truncated index both look exactly like "still working",
# and the job is then killed by its own timeout with nothing said about why. The
# wrappers below bound every network wait, check that the index can satisfy the
# request before asking for it, and turn each way apt can fail into the sentence
# that names it.
#
# The waits are deliberately short: fetching an index or a handful of library
# packages from archive.ubuntu.com is seconds of work on a runner, so a wait that
# lasts a minute is already a mirror problem, not a slow one.

APT_TIMEOUT_UPDATE=${APT_TIMEOUT_UPDATE:-120}
APT_TIMEOUT_INSTALL=${APT_TIMEOUT_INSTALL:-300}
# The dry run only reads the index on disk, so it needs no patience: thirty
# seconds is already generous for a few hundred dependency names, and anything
# past that is a broken index, not a slow one.
APT_TIMEOUT_SIMULATE=${APT_TIMEOUT_SIMULATE:-30}
APT_TIMEOUT_ACQUIRE=${APT_TIMEOUT_ACQUIRE:-15}
# The index is not retried: a mirror that cannot be reached answers the same way
# three times, and that finding is worth reporting as it is. A package download
# is different -- the runner's route to archive.ubuntu.com drops single
# connections -- so it gets two more tries, each still capped at
# APT_TIMEOUT_ACQUIRE and the whole step at APT_TIMEOUT_INSTALL.
APT_RETRIES_INSTALL=${APT_RETRIES_INSTALL:-2}

ubuntu_apt_update() {
  local log=/tmp/apt-update.log
  local status=0
  timeout "$APT_TIMEOUT_UPDATE" apt-get update -qq \
    -o "Acquire::Retries=0" \
    -o "Acquire::http::Timeout=$APT_TIMEOUT_ACQUIRE" \
    -o "Acquire::https::Timeout=$APT_TIMEOUT_ACQUIRE" \
    >"$log" 2>&1 || status=$?

  if [ "$status" -eq 0 ]; then
    # An update that exits 0 says the lists were written, not that they carry
    # anything: a mirror or a caching proxy answering with an empty file leaves
    # an index with no packages in it, and every dependency then reads as
    # unsatisfiable. The count is the cheapest way to tell that apart from a slow
    # mirror, and it is the number the next failure would have to explain.
    local packages
    packages=$(apt-cache pkgnames 2>/dev/null | wc -l | tr -d ' ')
    if [ "$packages" -eq 0 ]; then
      tail -n 10 "$log"
      echo "::error::apt-get update exited 0 but left an index with no packages: the lists it downloaded are empty, so nothing could be installed from them"
      return 1
    fi
    echo "the index apt received lists $packages packages"
    return 0
  fi

  tail -n 15 "$log"
  if [ "$status" -eq 124 ]; then
    echo "::error::apt-get update was cut after ${APT_TIMEOUT_UPDATE}s without an answer from any mirror: the container's network stalled, the package was never consulted"
    return 1
  fi
  echo "::error::apt-get update failed with exit $status: $(tail -n 3 "$log" | tr '\n' ' ')"
  return 1
}

# A dry run answers "can the index install this?" in a second and with no
# download, so a missing candidate stops the job instead of becoming a transfer
# apt waits on. It is also the only check that is right about names apt resolves
# through a `Provides`: in 24.04 the `.deb` depends on `libgtk-3-0`, which is a
# virtual name provided by `libgtk-3-0t64`, and `apt-cache policy libgtk-3-0`
# reports `Candidate: (none)` for it while apt installs it without complaint.
ubuntu_apt_simulate() {
  local log=/tmp/apt-simulate.log
  local status=0
  timeout "$APT_TIMEOUT_SIMULATE" apt-get install -y --no-install-recommends -s "$@" \
    >"$log" 2>&1 || status=$?

  if [ "$status" -eq 0 ]; then
    return 0
  fi

  tail -n 20 "$log"
  if [ "$status" -eq 124 ]; then
    echo "::error::apt could not read its own index in ${APT_TIMEOUT_SIMULATE}s: the dry run never touches the network, so that index is unusable, not slow"
    return 1
  fi
  echo "::error::apt cannot install $* from the index it received: $(grep -E 'Depends:|E:' "$log" | tail -n 3 | tr '\n' ' ')"
  return 1
}

ubuntu_apt_install() {
  local log=/tmp/apt-install.log
  local status=0
  timeout "$APT_TIMEOUT_INSTALL" apt-get install -y --no-install-recommends \
    -o "Acquire::Retries=$APT_RETRIES_INSTALL" \
    -o "Acquire::http::Timeout=$APT_TIMEOUT_ACQUIRE" \
    -o "Acquire::https::Timeout=$APT_TIMEOUT_ACQUIRE" \
    "$@" >"$log" 2>&1 || status=$?

  if [ "$status" -eq 0 ]; then
    return 0
  fi

  tail -n 25 "$log"
  if [ "$status" -eq 124 ]; then
    echo "::error::apt-get install was cut after ${APT_TIMEOUT_INSTALL}s with a download unfinished: a mirror stopped answering, which no retry from inside the container can fix"
    return 1
  fi
  echo "::error::apt could not install $*: $(tail -n 5 "$log" | tr '\n' ' ')"
  return 1
}
