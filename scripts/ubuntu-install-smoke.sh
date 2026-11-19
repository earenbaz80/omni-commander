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

# shellcheck source=scripts/ubuntu-apt.sh
source "$(dirname "${BASH_SOURCE[0]}")/ubuntu-apt.sh"

# The container fetches its package index over the runner's network. A partially
# written index makes every dependency below read as "not installable", and an
# unreachable mirror makes apt wait for as long as it is allowed to, which a job
# timeout turns into twenty silent minutes. The wrapper bounds the wait and says
# which of the two happened.
ubuntu_apt_update

# Resolved against the index before anything is fetched: a dependency this index
# cannot satisfy has to stop the job here, not become a download apt waits on and
# then refuses one package at a time.
ubuntu_apt_simulate "$PACKAGE"

# By path, so apt resolves the dependencies of this package and not those of a
# release that happens to be published.
ubuntu_apt_install "$PACKAGE"

package_name=$(dpkg-deb -f "$PACKAGE" Package)

# The program to run, taken from what the package itself says a click runs. The
# `.deb` installs no command on PATH -- the menu entry is the launcher -- so
# reading `Exec=` is the only way to start what a desktop user starts; a name
# written here, or the first executable under /opt, would be a guess that
# answers a different question.
program=""
args=()
started_via=""
desktop_file=$(dpkg -L "$package_name" | grep -E '^/usr/share/applications/.*\.desktop$' | head -n 1 || true)
if [ -n "$desktop_file" ]; then
  exec_line=$(grep -m1 '^Exec=' "$desktop_file" | cut -d= -f2- || true)
  # Field codes (%U, %F, %i, ...) are arguments the desktop fills in, not part of
  # the command the entry names.
  exec_line=$(printf '%s' "$exec_line" | sed -E 's/[[:space:]]*%[fFuUdDnNickvm]//g')
  rest=""
  if [[ $exec_line =~ ^\"([^\"]*)\"(.*)$ ]]; then
    program=${BASH_REMATCH[1]}
    rest=${BASH_REMATCH[2]}
  elif [[ $exec_line =~ ^([^[:space:]]+)(.*)$ ]]; then
    program=${BASH_REMATCH[1]}
    rest=${BASH_REMATCH[2]}
  fi
  read -r -a args <<< "$rest" || true
  started_via="the desktop entry $desktop_file"
fi

if [ -n "$program" ]; then
  if [ ! -x "$program" ]; then
    echo "::error::the desktop entry runs $program, which the package did not install or cannot execute"
    exit 1
  fi
  program=$(readlink -f "$program")
fi

# Fallbacks for a package that ships no menu entry: a command on PATH first, and
# only then a scan of /opt. Chromium's helpers ship next to the app under /opt
# and `chrome-sandbox` is executable too, so "the first executable under /opt"
# is a binary that answers every switch with a sandbox error instead of the app.
launcher=""
if [ -z "$program" ]; then
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
fi
if [ -z "$program" ] && [ -n "$launcher" ]; then
  program=$(readlink -f "$launcher")
  started_via="the command on PATH $launcher"
fi
if [ -z "$program" ]; then
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
  started_via="a scan of /opt, because the package installs no menu entry"
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
# The log says which of the three paths was taken, because only the first
# answers the question a user has: does clicking the icon open the app.
echo "the launcher is $started_via"

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
ubuntu_apt_install xvfb xauth

# The boot and the window check live in a shared helper: the AppImage job asks
# the same question with the same evidence, and two copies of this logic would
# drift in exactly the part that decides what "it opened" means.
# shellcheck source=scripts/ubuntu-app-boot.sh
source "$(dirname "${BASH_SOURCE[0]}")/ubuntu-app-boot.sh"
boot_and_verify_window "the copy the .deb installed" "$program" "${args[@]}"

echo "the .deb installed on a clean ubuntu:24.04 and its window loaded"
