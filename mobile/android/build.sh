#!/usr/bin/env bash
# ============================================================
#  Build a standalone Hertz Forge APK with the Android SDK
#  command-line tools (no Gradle, no Android Studio).
#
#  Usage:  bash mobile/android/build.sh
#  Output: mobile/build/hertz-forge-playlist.apk
# ============================================================
set -euo pipefail

WEB="$(cd "$(dirname "$0")/.." && pwd)"   # mobile/ (PWA source + android wrapper)
REPO="$(cd "$WEB/.." && pwd)"              # repository root (desktop app, SDK)
APP="$WEB/android"
# The SDK may live outside the project: the sdkmanager installer cannot handle
# a path containing spaces, so HF_SDK points at a space-free install.
SDK="${HF_SDK:-$REPO/.android-sdk}"
BT="$SDK/build-tools/35.0.0"
AJAR="$SDK/platforms/android-34/android.jar"
BUILD="$APP/build"
DIST="$WEB/build"
APK_NAME="hertz-forge-playlist.apk"

export JAVA_HOME="${JAVA_HOME:-C:/Program Files/Eclipse Adoptium/jdk-21.0.8.9-hotspot}"

if [ ! -f "$AJAR" ] || [ ! -x "$BT/aapt2.exe" ]; then
  echo "Android SDK not found at $SDK (need platforms;android-34 and build-tools;34.0.0)" >&2
  exit 1
fi

rm -rf "$BUILD"
mkdir -p "$BUILD/assets" "$BUILD/gen" "$BUILD/classes" "$BUILD/dex" "$DIST"

# ── 1. web app -> assets ───────────────────────────────────
echo "[1/7] staging web assets"
cp -r "$WEB/app/index.html" "$WEB/app/css" "$WEB/app/js" \
      "$WEB/app/icons" "$WEB/app/manifest.webmanifest" "$WEB/app/sw.js" \
      "$BUILD/assets/"

# ── 2. app icon ────────────────────────────────────────────
echo "[2/7] staging icon"
mkdir -p "$BUILD/res/mipmap-xxhdpi" "$BUILD/res/mipmap-xxxhdpi" "$BUILD/res/values"
cp "$WEB/app/icons/icon-192.png" "$BUILD/res/mipmap-xxhdpi/ic_launcher.png"
cp "$WEB/app/icons/icon-512.png" "$BUILD/res/mipmap-xxxhdpi/ic_launcher.png"

# ── 3. resources ───────────────────────────────────────────
echo "[3/7] compiling resources"
"$BT/aapt2.exe" compile --dir "$BUILD/res" -o "$BUILD/res.zip"
"$BT/aapt2.exe" link \
  -o "$BUILD/base.apk" \
  -I "$AJAR" \
  --manifest "$APP/AndroidManifest.xml" \
  -A "$BUILD/assets" \
  --java "$BUILD/gen" \
  --min-sdk-version 29 \
  --target-sdk-version 34 \
  --version-code 1 \
  --version-name 1.0 \
  "$BUILD/res.zip"

# ── 4. java -> class -> dex ────────────────────────────────
echo "[4/7] compiling java"
# arrays, not $(find): the project path contains spaces
mapfile -t SOURCES < <(find "$BUILD/gen" "$APP/src" -name '*.java')
echo "  ${#SOURCES[@]} java file(s)"
javac -source 11 -target 11 -nowarn \
  -classpath "$AJAR" \
  -d "$BUILD/classes" \
  "${SOURCES[@]}"

echo "[5/7] dexing"
# call d8 through java: the .bat wrapper splits paths that contain spaces
mapfile -t CLASSES < <(find "$BUILD/classes" -name '*.class')
echo "  ${#CLASSES[@]} class file(s)"
java -cp "$BT/lib/d8.jar" com.android.tools.r8.D8 \
  --release --min-api 29 --lib "$AJAR" \
  --output "$BUILD/dex" \
  "${CLASSES[@]}"

# ── 5. package + align + sign ──────────────────────────────
echo "[6/7] packaging"
python - "$BUILD/base.apk" "$BUILD/dex/classes.dex" <<'PY'
import sys, zipfile
apk, dex = sys.argv[1], sys.argv[2]
with zipfile.ZipFile(apk, 'a', zipfile.ZIP_DEFLATED) as z:
    z.write(dex, 'classes.dex')
print("  classes.dex added")
PY
"$BT/zipalign.exe" -f -p 4 "$BUILD/base.apk" "$BUILD/aligned.apk"

echo "[7/7] signing"
KEYSTORE="$APP/keystore/debug.keystore"
if [ ! -f "$KEYSTORE" ]; then
  mkdir -p "$(dirname "$KEYSTORE")"
  keytool -genkeypair -v -keystore "$KEYSTORE" -storepass android -keypass android \
    -alias androiddebugkey -keyalg RSA -keysize 2048 -validity 10000 \
    -dname "CN=Android Debug,O=Android,C=US" >/dev/null 2>&1
fi
# call apksigner through java for the same reason
java -jar "$BT/lib/apksigner.jar" sign \
  --ks "$KEYSTORE" --ks-pass pass:android --key-pass pass:android \
  --min-sdk-version 29 \
  --out "$DIST/$APK_NAME" "$BUILD/aligned.apk"
java -jar "$BT/lib/apksigner.jar" verify "$DIST/$APK_NAME"

echo
echo "APK: $DIST/$APK_NAME"
ls -lh "$DIST/$APK_NAME"
"$BT/aapt2.exe" dump badging "$DIST/$APK_NAME" | head -6
