#!/usr/bin/env bash
#
# Sourced by the clean-container smokes, never run on its own: it boots an
# installed app under Xvfb and answers one question -- did its window load? --
# the same way for a .deb and for an AppImage, so the two checks cannot drift
# apart in what they accept as "it opened".
#
# `boot_and_verify_window "<what was started>" <command> [args...]` returns
# non-zero, with the app's own log, when no window appeared.

boot_and_verify_window() {
  local started=$1
  shift

  # `--no-sandbox` is a container concession, not an app setting: this runs as
  # root, where Electron refuses to start. The switch alone is not enough -- a
  # renderer started as its own process reads the environment, not the parent's
  # argv, and dies on the same check (exitCode 133) -- so the sandbox is
  # disabled through the environment as well. A desktop user needs neither.
  ELECTRON_ENABLE_LOGGING=1 ELECTRON_DISABLE_SANDBOX=1 xvfb-run -a "$@" \
    --no-sandbox --disable-gpu --disable-dev-shm-usage --remote-debugging-port=9333 \
    >/tmp/app.log 2>&1 &
  local app=$!

  local opened=0
  for _ in $(seq 1 90); do
    if (exec 3<>/dev/tcp/127.0.0.1/9333) 2>/dev/null; then
      opened=1
      break
    fi
    # An app that dies before opening its port has nothing left to wait for.
    if ! kill -0 "$app" 2>/dev/null; then
      break
    fi
    sleep 1
  done

  # The window's own URL, read from the DevTools endpoint: a process that opened
  # the port but never loaded the packaged renderer has not started the app.
  local pages=""
  if [ "$opened" = 1 ]; then
    # HTTP/1.1, not 1.0: the DevTools server rejects the older protocol outright
    # ("Cannot handle request with protocol: HTTP/1.0"), so a 1.0 probe cannot
    # tell a window that never loaded from a request that was never answered.
    pages=$(timeout 5 bash -c 'exec 3<>/dev/tcp/127.0.0.1/9333; printf "GET /json/list HTTP/1.1\r\nHost: 127.0.0.1\r\nConnection: close\r\n\r\n" >&3; cat <&3' 2>/dev/null || true)
  fi

  app_log() {
    printf '%s' "$(tr '\n' ' ' </tmp/app.log | tail -c 1500)"
  }

  if [ "$opened" != 1 ] || ! printf '%s' "$pages" | grep -q 'index\.html'; then
    tail -n 40 /tmp/app.log
    echo "app log is $(wc -c </tmp/app.log) bytes; alive: $(kill -0 "$app" 2>/dev/null && echo yes || echo no)"
    echo "::error::$started did not load its window on a clean ubuntu:24.04; log: $(app_log)"
    return 1
  fi

  sleep 2
  if ! kill -0 "$app" 2>/dev/null; then
    tail -n 40 /tmp/app.log
    echo "::error::$started closed right after loading its window; log: $(app_log)"
    return 1
  fi
  if grep -qE 'Segmentation fault|FATAL:|ERR_FILE_NOT_FOUND' /tmp/app.log; then
    echo "::error::the log of $started carries a fatal line: $(grep -E 'Segmentation fault|FATAL:|ERR_FILE_NOT_FOUND' /tmp/app.log | head -n 2 | tr '\n' ' ')"
    return 1
  fi

  echo "$started loaded its window on a clean ubuntu:24.04"
}
