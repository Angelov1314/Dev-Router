#!/bin/bash
# Creates a macOS .app bundle for Dev Router on your Desktop.
# Usage: bash create-app.sh [node_path]
#
# The app will:
#   1. Kill any existing process on port 4000
#   2. Start the Dev Router server
#   3. Open http://localhost:4000 in your default browser

set -e

APP_NAME="Dev Router"
APP_PATH="$HOME/Desktop/$APP_NAME.app"
SCRIPT_DIR="$(cd "$(dirname "$0")" && pwd)"
NODE_PATH="${1:-$(which node)}"

if [ -z "$NODE_PATH" ]; then
  echo "Error: node not found. Pass the path as argument: bash create-app.sh /path/to/node"
  exit 1
fi

echo "Creating $APP_PATH ..."

mkdir -p "$APP_PATH/Contents/MacOS"
mkdir -p "$APP_PATH/Contents/Resources"

# Info.plist
cat > "$APP_PATH/Contents/Info.plist" << 'PLIST'
<?xml version="1.0" encoding="UTF-8"?>
<!DOCTYPE plist PUBLIC "-//Apple//DTD PLIST 1.0//EN" "http://www.apple.com/DTDs/PropertyList-1.0.dtd">
<plist version="1.0">
<dict>
  <key>CFBundleExecutable</key>
  <string>launch</string>
  <key>CFBundleName</key>
  <string>Dev Router</string>
  <key>CFBundleIdentifier</key>
  <string>com.dev-router.app</string>
  <key>CFBundleVersion</key>
  <string>1.0</string>
  <key>CFBundlePackageType</key>
  <string>APPL</string>
  <key>LSUIElement</key>
  <true/>
</dict>
</plist>
PLIST

# Launch script
cat > "$APP_PATH/Contents/MacOS/launch" << LAUNCH
#!/bin/bash
DIR="$SCRIPT_DIR"
PORT=\${DEV_ROUTER_PORT:-4000}

# Load shell profile for nvm / homebrew / etc.
export HOME="$HOME"
[ -s "\$HOME/.nvm/nvm.sh" ] && source "\$HOME/.nvm/nvm.sh"
export PATH="$(dirname "$NODE_PATH"):/opt/homebrew/bin:/usr/local/bin:\$PATH"

# Kill existing instance
lsof -ti:\$PORT 2>/dev/null | xargs kill -9 2>/dev/null
sleep 0.3

# Start server
cd "\$DIR"
node server.js > "\$DIR/server.log" 2>&1 &

# Wait for ready
for i in \$(seq 1 30); do
  curl -s "http://localhost:\$PORT" > /dev/null 2>&1 && { open "http://localhost:\$PORT"; exit 0; }
  sleep 0.3
done

osascript -e 'display alert "Dev Router" message "Failed to start. Check server.log." as critical'
LAUNCH

chmod +x "$APP_PATH/Contents/MacOS/launch"

echo "Done! Double-click '$APP_NAME' on your Desktop to launch."
