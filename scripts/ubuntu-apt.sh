#!/usr/bin/env bash
#
# Sourced by the clean-container smokes, never run on its own.
#
# A container's apt has no reason to hang for the length of a job: a mirror that
# stopped answering and a truncated index both look exactly like "still working",
# and the job is then killed by its own timeout with nothing said about why. The
# wrappers below bound every network wait, check that the index actually offers a
# candidate before asking for one, and turn each way apt can fail into the
# sentence that names it.
#
# The waits are deliberately short: fetching an index or a handful of library
# packages from archive.ubuntu.com is seconds of work on a runner, so a wait that
# lasts a minute is already a mirror problem, not a slow one.

APT_TIMEOUT_UPDATE=${APT_TIMEOUT_UPDATE:-120}
APT_TIMEOUT_INSTALL=${APT_TIMEOUT_INSTALL:-300}
APT_TIMEOUT_ACQUIRE=${APT_TIMEOUT_ACQUIRE:-15}

# The names a Depends field mentions: no versions, no alternatives, because what
# apt needs is a candidate for the first one it can use.
ubuntu_deb_dependency_names() {
  dpkg-deb -f "$1" Depends |
    tr ',' '\n' |
    sed -E 's/\(.*\)//g; s/\|.*//; s/[[:space:]]//g' |
    grep -v '^$' || true
}

ubuntu_apt_update() {
  local log=/tmp/apt-update.log
  local status=0
  timeout "$APT_TIMEOUT_UPDATE" apt-get update -qq \
    -o "Acquire::Retries=0" \
    -o "Acquire::http::Timeout=$APT_TIMEOUT_ACQUIRE" \
    -o "Acquire::https::Timeout=$APT_TIMEOUT_ACQUIRE" \
    >"$log" 2>&1 || status=$?

  if [ "$status" -eq 0 ]; then
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

# `Candidate: (none)` means the index knows the name but has no version it can
# install. A truncated or half-written index produces that for every dependency
# at once, and apt then reports each of them as "not installable" -- which reads
# like a broken package and is really a broken download.
ubuntu_require_candidates() {
  local missing=()
  local pkg
  for pkg in "$@"; do
    if ! apt-cache policy "$pkg" 2>/dev/null | grep -q '^ *Candidate:'; then
      missing+=("$pkg")
    elif apt-cache policy "$pkg" 2>/dev/null | grep -q '^ *Candidate: (none)'; then
      missing+=("$pkg")
    fi
  done

  if [ "${#missing[@]}" -eq 0 ]; then
    return 0
  fi

  echo "no installable candidate for: ${missing[*]}"
  apt-cache policy "${missing[0]}" 2>&1 | head -n 4
  echo "::error::the package index offers no candidate for ${missing[*]}, so apt would have waited on a download and then refused every dependency in turn: the index this container received is incomplete"
  return 1
}

ubuntu_apt_install() {
  local log=/tmp/apt-install.log
  local status=0
  timeout "$APT_TIMEOUT_INSTALL" apt-get install -y --no-install-recommends \
    -o "Acquire::Retries=0" \
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
