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

apt-get update -qq || {
  echo "::error::apt-get update failed in the container"
  exit 1
}

# By path, so apt resolves the dependencies of this package and not those of a
# release that happens to be published.
if ! install_log=$(apt-get install -y --no-install-recommends "$PACKAGE" 2>&1); then
  printf '%s\n' "$install_log" | tail -n 25
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
else
  program=$(dpkg -L "$package_name" | while IFS= read -r candidate; do
    case "$candidate" in
      /opt/*)
        case "$(basename "$candidate")" in
          chrome*) continue ;;
        esac
        if [ -f "$candidate" ] && [ -x "$candidate" ]; then
          printf '%s\n' "$candidate"
          break
        fi
        ;;
    esac
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

# The shared libraries the binary itself resolves. Empty here means the package
# brought everything it links against.
missing=$(ldd "$program" 2>&1 | grep 'not found' || true)
if [ -n "$missing" ]; then
  echo "::error::the .deb did not declare every shared library: $(printf '%s' "$missing" | tr '\n' ' ')"
  exit 1
fi

# Now the display. A desktop provides X, so this is what the package is allowed
# to assume is already there.
apt-get install -y -qq --no-install-recommends xvfb

xvfb-run -a "$program" --no-sandbox --disable-gpu --disable-dev-shm-usage --remote-debugging-port=9333 \
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
  pages=$(timeout 5 bash -c 'exec 3<>/dev/tcp/127.0.0.1/9333; printf "GET /json/list HTTP/1.0\r\nHost: 127.0.0.1\r\nConnection: close\r\n\r\n" >&3; cat <&3' 2>/dev/null || true)
fi

if [ "$opened" != 1 ] || ! printf '%s' "$pages" | grep -q 'index\.html'; then
  echo "::error::the app did not load its window on a clean ubuntu:24.04; last lines: $(tail -n 12 /tmp/app.log | tr '\n' ' ')"
  exit 1
fi

sleep 2
if ! kill -0 "$app" 2>/dev/null; then
  echo "::error::the app closed right after loading its window; last lines: $(tail -n 12 /tmp/app.log | tr '\n' ' ')"
  exit 1
fi
if grep -qE 'Segmentation fault|FATAL:|ERR_FILE_NOT_FOUND' /tmp/app.log; then
  echo "::error::the app log carries a fatal line: $(grep -E 'Segmentation fault|FATAL:|ERR_FILE_NOT_FOUND' /tmp/app.log | head -n 2 | tr '\n' ' ')"
  exit 1
fi

echo "the .deb installed on a clean ubuntu:24.04 and its window loaded"
