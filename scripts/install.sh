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

resolve_download_url() {
  local asset="$1"
  if [[ "$VERSION" == "latest" ]]; then
    echo "https://github.com/$REPO/releases/latest/download/$asset"
  else
    echo "https://github.com/$REPO/releases/download/$VERSION/$asset"
  fi
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
  local asset url dir tmp
  asset="$(detect_target)"
  url="$(resolve_download_url "$asset")"
  dir="$(pick_install_dir)"
  mkdir -p "$dir"
  tmp="$(mktemp)"
  echo "Downloading $url"
  curl -fsSL "$url" -o "$tmp"
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
