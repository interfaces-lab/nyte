#!/usr/bin/env bash
set -euo pipefail

usage() {
  echo "Usage: bash scripts/build-mac-release.sh <ssh-host> <remote-repo> <new-output-directory> [commit]"
}

if [[ "${1:-}" == --help ]]; then
  usage
  exit 0
fi
if (( $# < 3 || $# > 4 )); then
  usage >&2
  exit 2
fi

host=$1
remote_repo=$2
output=$3
ref=${4:-HEAD}

if [[ ! "$host" =~ ^[a-zA-Z0-9][a-zA-Z0-9_.@-]*$ || ! "$remote_repo" =~ ^/[a-zA-Z0-9_./-]+$ ]]; then
  echo "Use an SSH host alias and an absolute remote repository path without spaces." >&2
  exit 2
fi
if [[ -e "$output" || -L "$output" ]]; then
  echo "Output already exists: $output. Choose a new directory." >&2
  exit 2
fi
if [[ $(uname -s) != Linux ]]; then
  echo "Run this command on the Linux build machine." >&2
  exit 2
fi
for name in NYTE_CONNECT_ORIGIN NYTE_CLERK_PUBLISHABLE_KEY NYTE_CLERK_FRONTEND_API_HOST; do
  if [[ -z "${!name:-}" ]]; then
    echo "Set $name before building a release." >&2
    exit 2
  fi
done
command -v sha256sum >/dev/null
if [[ ! -d $(dirname -- "$output") ]]; then
  echo "Create the output parent directory first: $(dirname -- "$output")" >&2
  exit 2
fi

repo=$(git rev-parse --show-toplevel)
commit=$(git -C "$repo" rev-parse --verify --end-of-options "${ref}^{commit}")
git -C "$repo" cat-file -e "$commit:packages/desktop/scripts/assets.mjs"
ssh_options=(-o BatchMode=yes -o ConnectTimeout=15 -o ForwardAgent=no)

echo "Build commit $commit on Linux; package and sign on $host using $remote_repo."
echo "Download release files to $output. Nothing will be published."
ssh "${ssh_options[@]}" -- "$host" "bash -s -- '$remote_repo'" <<'REMOTE'
set -euo pipefail
[[ $(uname -sm) == "Darwin arm64" ]] || { echo "The release worker must be an Apple Silicon Mac." >&2; exit 1; }
set -a
source "$HOME/.config/nyte/release.env"
set +a
for tool in git node pnpm bun codesign xcrun; do command -v "$tool" >/dev/null; done
git -C "$1" rev-parse --git-dir >/dev/null
REMOTE

work=$(mktemp -d)
cleanup() {
  if [[ -d "$work/source" ]]; then
    git -C "$repo" worktree remove --force "$work/source"
  fi
  rm -rf "$work"
}
trap cleanup EXIT

git -C "$repo" worktree add --detach "$work/source" "$commit"
export VITE_NYTE_CONNECT_ORIGIN="$NYTE_CONNECT_ORIGIN"
export VITE_NYTE_CLERK_PUBLISHABLE_KEY="$NYTE_CLERK_PUBLISHABLE_KEY"
(
  cd "$work/source"
  pnpm install --frozen-lockfile
  node packages/desktop/scripts/assets.mjs build "$work/assets"
  pnpm --dir packages/canvas test
  pnpm --dir packages/app test
)

remote_work=$(ssh "${ssh_options[@]}" -- "$host" 'mktemp -d /tmp/nyte-release.XXXXXXXX')
if [[ ! "$remote_work" =~ ^/tmp/nyte-release\.[a-zA-Z0-9]+$ ]]; then
  echo "The Mac returned an invalid build directory." >&2
  exit 1
fi
echo "Mac build directory: $remote_work. A failed build is kept there for inspection."
scp "${ssh_options[@]}" -r -- "$work/assets" "$host:$remote_work/assets"
ssh "${ssh_options[@]}" -- "$host" "bash -s -- '$remote_repo' '$commit' '$remote_work'" <<'REMOTE'
set -euo pipefail
repo=$1
commit=$2
work=$3
set -a
source "$HOME/.config/nyte/release.env"
set +a
for name in CSC_LINK CSC_KEY_PASSWORD APPLE_API_KEY APPLE_API_KEY_ID APPLE_API_ISSUER NYTE_CONNECT_ORIGIN NYTE_CLERK_PUBLISHABLE_KEY NYTE_CLERK_FRONTEND_API_HOST; do
  if [[ -z "${!name:-}" ]]; then echo "Set $name in the Mac's release.env." >&2; exit 1; fi
done
test -f "$APPLE_API_KEY"
[[ "${NYTE_UPDATE_TEST:-}" != 1 ]] || { echo "NYTE_UPDATE_TEST cannot be used for a release." >&2; exit 1; }
export VITE_NYTE_CONNECT_ORIGIN="$NYTE_CONNECT_ORIGIN"
export VITE_NYTE_CLERK_PUBLISHABLE_KEY="$NYTE_CLERK_PUBLISHABLE_KEY"
export MAIN_VITE_NYTE_CONNECT_ORIGIN="$NYTE_CONNECT_ORIGIN"
export MAIN_VITE_NYTE_CLERK_PUBLISHABLE_KEY="$NYTE_CLERK_PUBLISHABLE_KEY"
export MAIN_VITE_NYTE_CLERK_FRONTEND_API_HOST="$NYTE_CLERK_FRONTEND_API_HOST"

git -C "$repo" fetch origin "$commit"
git -C "$repo" worktree add --detach "$work/source" "$commit"
cd "$work/source"
pnpm install --frozen-lockfile
NODE_ENV=production node packages/desktop/scripts/build.mjs --assets "$work/assets" --package --publish never --mac --arm64
app=packages/desktop/dist/mac-arm64/Nyte.app
codesign --verify --deep --strict "$app"
xcrun stapler validate "$app"
spctl --assess --type execute "$app"
"$app/Contents/Resources/nyte" --version

shopt -s nullglob
dmgs=(packages/desktop/dist/*.dmg)
zips=(packages/desktop/dist/*.zip)
if (( ${#dmgs[@]} != 1 || ${#zips[@]} != 1 )); then
  echo "Expected one signed DMG and one ZIP." >&2
  exit 1
fi
mkdir "$work/artifacts"
for file in "${dmgs[@]}" "${zips[@]}" packages/desktop/dist/*.blockmap packages/desktop/dist/latest*.yml; do
  cp "$file" "$work/artifacts/"
done
cd "$work/artifacts"
printf '%s\n' "$commit" > COMMIT
files=(./*)
shasum -a 256 "${files[@]}" > SHA256SUMS
REMOTE

scp "${ssh_options[@]}" -r -- "$host:$remote_work/artifacts" "$output"
(cd "$output" && sha256sum -c SHA256SUMS)
ssh "${ssh_options[@]}" -- "$host" "git -C '$remote_repo' worktree remove --force '$remote_work/source' && rm -rf '$remote_work'"
echo "Signed Mac release files: $output. Run the desktop smoke checks before publishing."
