#!/usr/bin/env bash
# Create a minimal macOS .app that launches the repository's `start-local` wrapper.
# Usage: ./scripts/create-mac-launcher.sh [install-dir] [app-name]

set -euo pipefail

INSTALL_DIR=${1:-"$HOME/Applications"}
APP_NAME=${2:-Zentra}
REPO_ROOT=$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)

APP_DIR="$INSTALL_DIR/$APP_NAME.app"
CONTENTS="$APP_DIR/Contents"
MACOS_DIR="$CONTENTS/MacOS"
RESOURCES_DIR="$CONTENTS/Resources"

echo "Creating $APP_DIR -> launches start-local in $REPO_ROOT"

mkdir -p "$MACOS_DIR" "$RESOURCES_DIR"

# Info.plist
LOWER_NAME=$(echo "$APP_NAME" | tr '[:upper:]' '[:lower:]')
cat > "$CONTENTS/Info.plist" <<EOF
<?xml version="1.0" encoding="UTF-8"?>
<!DOCTYPE plist PUBLIC "-//Apple//DTD PLIST 1.0//EN" "http://www.apple.com/DTDs/PropertyList-1.0.dtd">
<plist version="1.0">
<dict>
  <key>CFBundleName</key>
  <string>$APP_NAME</string>
  <key>CFBundleIdentifier</key>
  <string>local.zentra.${LOWER_NAME}</string>
  <key>CFBundleExecutable</key>
  <string>zentra-launcher</string>
  <key>CFBundlePackageType</key>
  <string>APPL</string>
  <key>NSHighResolutionCapable</key>
  <true/>
</dict>
</plist>
EOF

# The launcher executable: runs the repo start-local script from the project root.
LAUNCHER="$MACOS_DIR/zentra-launcher"
cat > "$LAUNCHER" <<'SH'
#!/usr/bin/env bash
set -euo pipefail
# Launcher with first-run repo picker.
# Embedded default repo path set at creation time below.
EMBEDDED_REPO='__EMBEDDED_REPO__'
CONFIG_DIR="$HOME/.zentra"
CONFIG_FILE="$CONFIG_DIR/launcher.conf"

choose_repo_via_gui() {
  # Use AppleScript to prompt the user to choose the repo folder.
  osascript <<'APPLESCRIPT'
  try
    set prompt to "Select your Zentra repository folder:" as text
    set theFolder to choose folder with prompt prompt
    POSIX path of theFolder
  on error
    return ""
  end try
APPLESCRIPT
}

REPO="$EMBEDDED_REPO"
if [ -f "$CONFIG_FILE" ]; then
  READ=$(cat "$CONFIG_FILE" 2>/dev/null || echo "")
  if [ -n "$READ" ]; then
    REPO="$READ"
  fi
fi

if [ ! -d "$REPO" ] || [ ! -x "$REPO/start-local" ]; then
  CHOSEN=$(choose_repo_via_gui)
  if [ -n "$CHOSEN" ] && [ -d "$CHOSEN" ]; then
    REPO="$CHOSEN"
    mkdir -p "$CONFIG_DIR"
    printf '%s' "$REPO" > "$CONFIG_FILE"
  else
    # No valid repo selected; fallback to embedded path if valid
    if [ ! -d "$REPO" ]; then
      echo "Repository not found. Please recreate the app or run start-local from the repo." >&2
      exit 1
    fi
  fi
fi

cd "$REPO" || exit 1
export PATH="$REPO/node_modules/.bin:$PATH"
# Run the start-local wrapper to boot the app and backend
exec "$REPO/start-local"
SH

# Replace placeholder with actual repo path (POSIX escaped)
sed -i.bak "s|__EMBEDDED_REPO__|$(printf '%s' "$REPO_ROOT" | sed 's|\\|\\\\|g')|g" "$LAUNCHER" || true
rm -f "$LAUNCHER.bak"

chmod +x "$LAUNCHER"

echo "Launcher created at $LAUNCHER"
echo "You can move $APP_DIR to /Applications or open it from Launchpad after running this script."
