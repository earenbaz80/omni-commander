#!/usr/bin/env bash
#
# Boots the AppImage that was published, inside the image it is already running
# in. The AppImage carries the app and nothing else: no GTK, NSS or X libraries,
# and no `Depends` to say which it needs. The package that declares them is the
# .deb, so the list apt installs here is the .deb's own `Depends`, taken from
# package.json and mounted at /tmp/depends.txt: a desktop is expected to have
# exactly that much.
#
# The runtime is told to extract itself and run from the copy. A container has no
# FUSE mount, and that flag is the same path the runtime takes on a desktop
# without libfuse2; the mount path is exercised by the preflight's own AppImage
# smoke, which runs on a runner where FUSE exists.
set -euo pipefail
export DEBIAN_FRONTEND=noninteractive

SOURCE=/tmp/app.AppImage
DEPENDS=/tmp/depends.txt
if [ ! -f "$SOURCE" ]; then
  echo "::error::no AppImage was mounted at $SOURCE"
  exit 1
fi
if [ ! -f "$DEPENDS" ]; then
  echo "::error::no dependency list was mounted at $DEPENDS"
  exit 1
fi

# Copied out of the mount: the runtime needs the file to be executable, and a
# `chmod` on a read-only mount is refused.
mkdir -p /tmp/appimage
install -m 0755 "$SOURCE" /tmp/appimage/omnicommander.AppImage
appimage=/tmp/appimage/omnicommander.AppImage

apt-get update -qq || {
  echo "::error::apt-get update failed in the container"
  exit 1
}

# An alternative is written `libasound2t64 | libasound2`. apt resolves the pipe
# itself, but `apt-get install` would read it as another package name, so the
# first alternative is taken here.
packages=()
while IFS= read -r line; do
  [ -z "$line" ] && continue
  first=${line%%|*}
  packages+=("$(printf '%s' "$first" | tr -d '[:space:]')")
done < "$DEPENDS"
echo "installing the libraries the .deb declares: ${packages[*]}"

if ! install_log=$(apt-get install -y --no-install-recommends "${packages[@]}" xvfb xauth 2>&1); then
  printf '%s\n' "$install_log" | tail -n 25
  apt-cache policy libgbm1 2>&1 | head -n 4
  echo "::error::apt could not install the libraries the AppImage needs: $(printf '%s' "$install_log" | tail -n 5 | tr '\n' ' ')"
  exit 1
fi

# shellcheck source=scripts/ubuntu-app-boot.sh
source "$(dirname "${BASH_SOURCE[0]}")/ubuntu-app-boot.sh"
boot_and_verify_window "the published AppImage" "$appimage" --appimage-extract-and-run
