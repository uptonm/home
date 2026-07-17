#!/usr/bin/env bash
# Install the latest `home` binary from GitHub Releases.
# Usage:
#   curl -fsSL https://raw.githubusercontent.com/uptonm/home/main/scripts/install.sh | bash
#   HOME_REPO=owner/repo HOME_VERSION=v0.1.0 ./install.sh
set -euo pipefail

REPO="${HOME_REPO:-uptonm/home}"
VERSION="${HOME_VERSION_TAG:-latest}"

detect_target() {
  local os arch
  case "$(uname -s)" in
    Linux) os=linux ;;
    Darwin) os=darwin ;;
    *) echo "unsupported OS: $(uname -s)" >&2; exit 1 ;;
  esac
  case "$(uname -m)" in
    x86_64|amd64) arch=x64 ;;
    arm64|aarch64) arch=arm64 ;;
    *) echo "unsupported arch: $(uname -m)" >&2; exit 1 ;;
  esac
  if [[ "$os" == "linux" && "$arch" != "x64" ]]; then
    echo "no prebuilt binary for linux-$arch yet" >&2; exit 1
  fi
  if [[ "$os" == "darwin" && "$arch" != "arm64" ]]; then
    echo "no prebuilt binary for darwin-$arch yet" >&2; exit 1
  fi
  echo "home-${os}-${arch}"
}

# The release repo is private, so downloads go through the authenticated gh
# CLI. curl is kept only as a fallback for the day the repo (or a mirror) is
# public — an unauthenticated fetch of a private asset just 404s.
download_asset() {
  local asset="$1" out="$2"
  if command -v gh >/dev/null 2>&1 && gh auth status >/dev/null 2>&1; then
    if [[ "$VERSION" == "latest" ]]; then
      gh release download --repo "$REPO" --pattern "$asset" --output "$out" --clobber
    else
      gh release download "$VERSION" --repo "$REPO" --pattern "$asset" --output "$out" --clobber
    fi
    return
  fi
  local url
  if [[ "$VERSION" == "latest" ]]; then
    url="https://github.com/$REPO/releases/latest/download/$asset"
  else
    url="https://github.com/$REPO/releases/download/$VERSION/$asset"
  fi
  echo "gh not available/authenticated — trying unauthenticated $url"
  curl -fsSL "$url" -o "$out"
}

pick_install_dir() {
  local local_bin="$HOME/.local/bin"
  if [[ ":$PATH:" == *":$local_bin:"* ]]; then
    echo "$local_bin"; return
  fi
  if [[ -t 0 ]]; then
    read -rp "$local_bin is not on PATH. Install to /usr/local/bin with sudo? [y/N] " ans
    if [[ "$ans" =~ ^[Yy]$ ]]; then
      echo "/usr/local/bin"; return
    fi
  fi
  echo "$local_bin"
}

main() {
  local asset dir tmp
  asset="$(detect_target)"
  dir="$(pick_install_dir)"
  mkdir -p "$dir"
  tmp="$(mktemp)"
  echo "Downloading $asset ($VERSION) from $REPO"
  download_asset "$asset" "$tmp"
  chmod +x "$tmp"
  if [[ "$dir" == "/usr/local/bin" ]]; then
    sudo mv "$tmp" "$dir/home"
  else
    mv "$tmp" "$dir/home"
  fi
  echo "Installed: $dir/home"
  echo "Next: run 'home init' to set up ~/.config/home"
}

main "$@"
