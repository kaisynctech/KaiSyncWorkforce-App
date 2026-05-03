#!/usr/bin/env bash
# Vercel builds run on Linux; installs Flutter then builds web output to build/web.
set -euo pipefail

FLUTTER_VERSION="${FLUTTER_VERSION:-3.38.2}"
CHANNEL="${FLUTTER_CHANNEL:-stable}"
INSTALL_DIR="${PWD}/.vercel-flutter-sdk"
ARCHIVE_URL="https://storage.googleapis.com/flutter_infra_release/releases/${CHANNEL}/linux/flutter_linux_${FLUTTER_VERSION}-${CHANNEL}.tar.xz"

echo "Installing Flutter ${FLUTTER_VERSION} (${CHANNEL})..."
mkdir -p "${INSTALL_DIR}"
curl -fsSL "${ARCHIVE_URL}" -o /tmp/flutter-sdk.tar.xz
tar -xf /tmp/flutter-sdk.tar.xz -C "${INSTALL_DIR}"

export PATH="${INSTALL_DIR}/flutter/bin:${PATH}"

# Extracted Flutter SDK is a git checkout; Vercel runs as root → Git's "dubious ownership"
# guard exits 128 unless the SDK dir is marked safe (see git help safe.directory).
git config --global --add safe.directory "${INSTALL_DIR}/flutter"

flutter --version
flutter config --no-analytics --enable-web
flutter pub get
flutter build web --release

echo "Web build complete: build/web"
