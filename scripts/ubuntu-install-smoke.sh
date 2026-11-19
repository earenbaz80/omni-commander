#!/usr/bin/env bash
#
# Installs the .deb this run built into the image it is already running in, then
# boots it. A GitHub runner ships the GTK, NSS and X libraries Electron links
# against, so a package that forgot to declare one of them installs and starts
# there and dies on a user's machine; a bare ubuntu image has nothing but what
# the package says it needs.
#
# The display is the only thing installed after the package, and it is installed
# after the link check on purpose: xvfb's own dependencies could otherwise stand
# in for a library the package failed to pull in.
set -euo pipefail
export DEBIAN_FRONTEND=noninteractive

PACKAGE=/tmp/package.deb
if [ ! -f "$PACKAGE" ]; then
  echo "::error::no package was mounted at $PACKAGE"
  exit 1
fi

# The container fetches its package index over the runner's network, and a
# partially written index makes every dependency below read as "not installable"
# -- an apt failure that looks like a package problem. Retrying here would not
# help: when the archive is unreachable apt is waiting on a connection, not on a
# transfer it could start over, so the run is left to fail once and say why.
apt-get update -qq || {
  echo "::error::apt-get update failed in the container"
  exit 1
}

# By path, so apt resolves the dependencies of this package and not those of a
# release that happens to be published.
if ! install_log=$(apt-get install -y --no-install-recommends "$PACKAGE" 2>&1); then
  printf '%s\n' "$install_log" | tail -n 25
  # A candidate of "(none)" says the index never arrived, which is a different
  # failure from a dependency this release of Ubuntu genuinely cannot satisfy.
  apt-cache policy libgbm1 2>&1 | head -n 4
  echo "::error::apt could not install the .deb: $(printf '%s' "$install_log" | tail -n 5 | tr '\n' ' ')"
  exit 1
fi

package_name=$(dpkg-deb -f "$PACKAGE" Package)

# The program to run, taken from the package's own file list rather than from a
# name written here. The launcher on PATH comes first: Chromium's helpers ship
# next to the app under /opt and `chrome-sandbox` is executable too, so "the
# first executable under /opt" is a binary that answers every switch with a
# sandbox error instead of the app.
launcher=""
via_launcher=no
while IFS= read -r candidate; do
  case "$candidate" in
    /usr/bin/*)
      if [ -f "$candidate" ]; then
        launcher=$candidate
        break
      fi
      ;;
  esac
done < <(dpkg -L "$package_name")

if [ -n "$launcher" ]; then
  program=$(readlink -f "$launcher")
  via_launcher=yes
else
  program=$(dpkg -L "$package_name" | while IFS= read -r candidate; do
    case "$candidate" in
      /opt/*) ;;
      *) continue ;;
    esac
    # The app is the one executable there whose name carries no suffix. What
    # else is executable beside it is Chromium's: `chrome-sandbox` and
    # `chrome_crashpad_handler` stop at every switch, and `libEGL.so` or
    # `libvulkan.so.1` are libraries with the executable bit set, which is a
    # core dump instead of a window.
    case "$(basename "$candidate")" in
      *.* | chrome*) continue ;;
    esac
    if [ -f "$candidate" ] && [ -x "$candidate" ]; then
      printf '%s\n' "$candidate"
      break
    fi
  done)
fi
if [ -z "$program" ]; then
  echo "::error::the .deb installed no runnable program under /opt; it installed: $(dpkg -L "$package_name" | tr '\n' ' ')"
  exit 1
fi
# The package is expected to keep its program under /opt and point at it.
case "$program" in
  /opt/*) ;;
  *)
    echo "::error::the .deb put its program at $program, outside /opt"
    exit 1
    ;;
esac
echo "installed $package_name, program at $program"
# Which path was taken matters: a desktop starts the package through the
# launcher on PATH, so "the window loaded" only speaks for a user's click when
# the launcher was the thing that started it.
if [ "$via_launcher" = yes ]; then
  echo "started through the launcher the package installs at $launcher"
else
  echo "the package installs no launcher on PATH; the program was run directly"
fi

# The menu entry has to name the program that was installed, or a desktop user
# gets an icon that does nothing.
desktop_file=$(dpkg -L "$package_name" | grep -E '^/usr/share/applications/.*\.desktop$' | head -n 1 || true)
if [ -n "$desktop_file" ] && ! grep -q "$(basename "$program")" "$desktop_file"; then
  echo "::error::the desktop entry does not name the installed program: $(grep -E '^Exec=' "$desktop_file" | tr '\n' ' ')"
  exit 1
fi

# The shared libraries the binary itself resolves. Empty here means the package
# brought everything it links against.
missing=$(ldd "$program" 2>&1 | grep 'not found' || true)
if [ -n "$missing" ]; then
  echo "::error::the .deb did not declare every shared library: $(printf '%s' "$missing" | tr '\n' ' ')"
  exit 1
fi

# Now the display. A desktop provides X, so this is what the package is allowed
# to assume is already there. `xauth` comes along because `xvfb-run` calls it and
# `--no-install-recommends` would leave it out.
apt-get install -y -qq --no-install-recommends xvfb xauth

# `--no-sandbox` is a container concession, not an app setting: this runs as root,
# where Electron refuses to start. The switch alone is not enough, though -- a
# renderer started as its own process reads the environment, not the parent's
# argv, and dies on the same check (exitCode 133) -- so the sandbox is disabled
# through the environment as well. A desktop user needs neither.
ELECTRON_ENABLE_LOGGING=1 ELECTRON_DISABLE_SANDBOX=1 xvfb-run -a "$program" \
  --no-sandbox --disable-gpu --disable-dev-shm-usage --remote-debugging-port=9333 \
  >/tmp/app.log 2>&1 &
app=$!

opened=0
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
pages=""
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
  echo "::error::the app did not load its window on a clean ubuntu:24.04 ($program); log: $(app_log)"
  exit 1
fi

sleep 2
if ! kill -0 "$app" 2>/dev/null; then
  tail -n 40 /tmp/app.log
  echo "::error::the app closed right after loading its window; log: $(app_log)"
  exit 1
fi
if grep -qE 'Segmentation fault|FATAL:|ERR_FILE_NOT_FOUND' /tmp/app.log; then
  echo "::error::the app log carries a fatal line: $(grep -E 'Segmentation fault|FATAL:|ERR_FILE_NOT_FOUND' /tmp/app.log | head -n 2 | tr '\n' ' ')"
  exit 1
fi

echo "the .deb installed on a clean ubuntu:24.04 and its window loaded"
