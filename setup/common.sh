# shellcheck shell=bash
# shellcheck disable=SC2034  # variables are used by the scripts that source this file
# Shared helpers for setup/install, setup/uninstall and the post-update hook
# (setup/spotify-like-repatch). Sourced, not run.

SPOTIFY_DIR=/opt/spotify
EXT_NAME=spotify-like-bridge.js
HOOK_NAME=spotify-like-repatch
HOOK_PATH="$HOME/.config/omarchy/hooks/post-update.d/$HOOK_NAME"
STATE_FILE="${XDG_STATE_HOME:-$HOME/.local/state}/spotify-like/install.state"
SPICETIFY_EXT_DIR="${XDG_CONFIG_HOME:-$HOME/.config}/spicetify/Extensions"

# Settings the install offers to turn off, and why (README → Security).
HARDENING_KEYS=(check_spicetify_update inject_theme_js experimental_features home_config sidebar_config)

ASSUME_YES=0
SPICETIFY_CONFIG=""
SPOTIFY_WAS_RUNNING=0

say() { printf '%s\n' "$*"; }
step() { printf '\n==> %s\n' "$*"; }
warn() { printf 'spotify-like: %s\n' "$*" >&2; }
die() { printf 'spotify-like: error: %s\n' "$*" >&2; exit 1; }

parse_args() {
  while (($# > 0)); do
    case "$1" in
    -y | --yes) ASSUME_YES=1 ;;
    -h | --help)
      say "Usage: $(basename "$0") [--yes]"
      say "  --yes  accept the default answer to every question"
      exit 0
      ;;
    *) die "unknown option: $1" ;;
    esac
    shift
  done
}

# confirm <prompt> <yes|no default>: true for yes, false for no; Ctrl-C or
# end of input aborts the script. With --yes the default answer is used.
confirm() {
  local prompt=$1 default=${2:-yes} answer rc=0
  if ((ASSUME_YES)); then
    [[ $default == yes ]]
    return
  fi
  [[ -t 0 && -t 1 ]] || die "not running in a terminal; pass --yes to accept the defaults"
  if command -v gum >/dev/null; then
    if [[ $default == yes ]]; then
      gum confirm --default=true "$prompt" || rc=$?
    else
      gum confirm --default=false "$prompt" || rc=$?
    fi
    case $rc in
    0) return 0 ;;
    1) return 1 ;;
    *) die "aborted" ;;
    esac
  fi
  if [[ $default == yes ]]; then
    read -r -p "$prompt [Y/n] " answer || { echo; die "aborted"; }
    [[ -z $answer || $answer == [Yy]* ]]
  else
    read -r -p "$prompt [y/N] " answer || { echo; die "aborted"; }
    [[ $answer == [Yy]* ]]
  fi
}

# Find Spicetify's config-xpui.ini once; ini_get reads it from then on.
load_spicetify_config() {
  SPICETIFY_CONFIG=$(spicetify -c 2>/dev/null || true)
}

# ini_get <section> <key>: a value from Spicetify's config-xpui.ini.
ini_get() {
  [[ -f $SPICETIFY_CONFIG ]] || return 0
  awk -v section="[$1]" -v key="$2" '
    /^\[/ { inside = ($0 == section); next }
    inside {
      k = $0; sub(/=.*/, "", k); gsub(/[ \t]/, "", k)
      if (k == key) {
        v = substr($0, index($0, "=") + 1)
        gsub(/^[ \t]+|[ \t]+$/, "", v)
        print v
        exit
      }
    }' "$SPICETIFY_CONFIG"
}

# Which config section a hardening key lives in.
key_section() {
  case "$1" in
  check_spicetify_update | inject_theme_js) echo Setting ;;
  *) echo AdditionalOptions ;;
  esac
}

extension_enabled() {
  local list
  list=$(ini_get AdditionalOptions extensions)
  [[ "|$list|" == *"|$EXT_NAME|"* ]]
}

# Spotify's Apps folder the way Spicetify sees it (src/status/spotify):
# stock = only .spa packages, applied = only extracted folders (patched),
# mixed = both (a Spotify update landed on top of a patched install).
spotify_state() {
  local f spa=0 dirs=0
  for f in "$SPOTIFY_DIR"/Apps/*; do
    if [[ -d $f ]]; then
      dirs=$((dirs + 1))
    elif [[ $f == *.spa ]]; then
      spa=$((spa + 1))
    fi
  done
  if ((spa && dirs)); then
    echo mixed
  elif ((spa)); then
    echo stock
  elif ((dirs)); then
    echo applied
  else
    echo invalid
  fi
}

# Run spicetify with no network, in an unprivileged user + network namespace.
# Otherwise spicetify downloads css-map.json from GitHub (main branch) and
# string-replaces it into Spotify's JavaScript, bypassing the checksum-pinned
# copy shipped in the package. Inside the namespace spicetify sees uid 0, hence
# --bypass-admin; --no-restart because a Spotify started in there would have no
# network either.
spicetify_offline() {
  unshare --map-root-user --net spicetify --bypass-admin --no-restart "$@"
}

# Patch Spotify with whatever spicetify command fits its current state.
spicetify_apply() {
  case $(spotify_state) in
  stock | mixed) spicetify_offline backup apply ;;
  applied)
    if [[ $(ini_get Backup with) == "$(spicetify -v)" ]]; then
      spicetify_offline apply
    else
      # The backup was made by another spicetify version.
      spicetify_offline restore backup apply
    fi
    ;;
  *) die "$SPOTIFY_DIR/Apps looks broken; reinstall Spotify (sudo pacman -S spotify) and run this again" ;;
  esac
}

# Spotify's embedded Chromium crashes when its app files are replaced while it
# runs, so quit it before patching and start it again afterwards.
stop_spotify() {
  local i
  pgrep -x spotify >/dev/null || return 0
  SPOTIFY_WAS_RUNNING=1
  pkill -x spotify || true
  for i in {1..50}; do
    pgrep -x spotify >/dev/null || return 0
    sleep 0.1
  done
  return 1
}

start_spotify_if_it_was_running() {
  ((SPOTIFY_WAS_RUNNING)) || return 0
  if command -v uwsm-app >/dev/null; then
    setsid -f uwsm-app -- spotify >/dev/null 2>&1 </dev/null
  else
    setsid -f spotify >/dev/null 2>&1 </dev/null
  fi || warn "could not start Spotify again; start it yourself"
}

state_get() {
  [[ -f $STATE_FILE ]] || return 0
  # Read as data; never source the file.
  grep -m1 "^$1=" "$STATE_FILE" | cut -d= -f2- || true
}

state_set() {
  mkdir -p "$(dirname "$STATE_FILE")"
  touch "$STATE_FILE"
  local tmp
  tmp=$(mktemp "$STATE_FILE.XXXXXX")
  grep -v "^$1=" "$STATE_FILE" >"$tmp" || true
  printf '%s=%s\n' "$1" "$2" >>"$tmp"
  mv "$tmp" "$STATE_FILE"
}

# Write access for this user only, through ACLs, instead of the
# `chmod a+wr` Spicetify's docs suggest. One sudo call for all of it.
# Arguments go to sudo (the post-update hook passes -n).
# shellcheck disable=SC2120  # options are optional
grant_acl() {
  sudo "$@" sh -c '
    setfacl -m "u:$1:rwx" /opt/spotify &&
    setfacl -R -m "u:$1:rwX" /opt/spotify/Apps &&
    find /opt/spotify/Apps -type d -exec setfacl -m "d:u:$1:rwX" {} +
  ' sh "$(id -un)"
}

# Remove only this user's ACL entries and give /opt/spotify/Apps back to root,
# as the package ships it (Spicetify recreates the folders as the user).
revoke_acl() {
  sudo sh -c '
    setfacl -x "u:$1" /opt/spotify 2>/dev/null
    setfacl -R -x "u:$1" /opt/spotify/Apps 2>/dev/null
    find /opt/spotify/Apps -type d -exec setfacl -x "d:u:$1" {} + 2>/dev/null
    chown -R root:root /opt/spotify/Apps &&
    chmod -R u=rwX,go=rX /opt/spotify/Apps
  ' sh "$(id -un)"
}
