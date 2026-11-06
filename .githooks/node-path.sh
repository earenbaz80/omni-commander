#!/usr/bin/env bash
#
# Git for Windows runs a hook with a PATH of its own, so a commit or a push
# started from a shell that never exported Node's dies as "npm: command not
# found" while both npm and Node are installed on the machine. Sourced by
# pre-commit and pre-push before they call either.
#
# Only PATH is extended: nothing is installed and nothing else is assumed, so a
# checkout without Node still reaches the hooks' own "skipping" messages instead
# of failing here.

# Windows settings hold backslashes, which this shell would read as escapes.
to_unix() {
  if command -v cygpath >/dev/null 2>&1; then
    cygpath -u "$1" 2>/dev/null || printf '%s' "$1"
  else
    printf '%s' "$1"
  fi
}

has_node() {
  command -v node >/dev/null 2>&1 && command -v npm >/dev/null 2>&1
}

# Where a Node installer and the usual Windows version managers keep their
# binaries. Stale entries cost one failed test each, so the list can be generous.
# `/nonexistent` stands in for a variable that is not set on this machine, and the
# two Windows defaults are also spelled out literally: Git Bash does not always
# export ProgramFiles to a hook, and that is the common install on this platform.
node_dirs() {
  printf '%s\n' \
    "$(to_unix "${NODE_HOME:-/nonexistent}")" \
    "$(to_unix "${NVM_SYMLINK:-/nonexistent}")" \
    "$(to_unix "${ProgramFiles:-/nonexistent}")/nodejs" \
    "$(to_unix "$(printenv 'ProgramFiles(x86)' 2>/dev/null || printf /nonexistent)")/nodejs" \
    "$(to_unix "${LOCALAPPDATA:-/nonexistent}")/Programs/nodejs" \
    "$(to_unix "${LOCALAPPDATA:-/nonexistent}")/Volta/bin" \
    "$(to_unix "${APPDATA:-/nonexistent}")/nvm" \
    "/c/Program Files/nodejs" \
    "/c/Program Files (x86)/nodejs" \
    /usr/local/bin \
    /opt/homebrew/bin
}

ensure_node() {
  has_node && return 0
  local dir
  while IFS= read -r dir; do
    if [ -x "$dir/node" ] || [ -f "$dir/node.exe" ]; then
      PATH="$dir:$PATH"
      export PATH
      has_node && return 0
    fi
  done < <(node_dirs)
  return 1
}
