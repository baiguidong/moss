export const MANAGED_RUNTIME_VERSIONS = Object.freeze({
  node: '22.22.2',
  python: '3.13.15',
  git: '2.47.1.windows.1',
});

export const RUNTIME_ARTIFACTS = Object.freeze({
  'darwin-arm64': Object.freeze({
    node: Object.freeze({
      filename: 'node-darwin-arm64.tar.gz',
      url: 'https://nodejs.org/dist/v22.22.2/node-v22.22.2-darwin-arm64.tar.gz',
      sha256: 'db4b275b83736df67533529a18cc55de2549a8329ace6c7bcc68f8d22d3c9000',
    }),
    python: Object.freeze({
      filename: 'python-darwin-arm64.tar.gz',
      url: 'https://github.com/astral-sh/python-build-standalone/releases/download/20260901/cpython-3.13.15%2B20260901-aarch64-apple-darwin-install_only_stripped.tar.gz',
      sha256: 'd3904bd6a072246e07aa0bdadee9a14e80521e42a943c0848059feb16a2816dc',
    }),
  }),
  'win32-x64': Object.freeze({
    node: Object.freeze({
      filename: 'node-win32-x64.zip',
      url: 'https://nodejs.org/dist/v22.22.2/node-v22.22.2-win-x64.zip',
      sha256: '7c93e9d92bf68c07182b471aa187e35ee6cd08ef0f24ab060dfff605fcc1c57c',
    }),
    python: Object.freeze({
      filename: 'python-win32-x64.tar.gz',
      url: 'https://github.com/astral-sh/python-build-standalone/releases/download/20260901/cpython-3.13.15%2B20260901-x86_64-pc-windows-msvc-install_only_stripped.tar.gz',
      sha256: '63d263ab0162f34a241a56dc5b283c22d6e131f5516117e6a921350c69ba7d4f',
    }),
    git: Object.freeze({
      filename: 'portablegit-win32-x64.7z.exe',
      url: 'https://github.com/git-for-windows/git/releases/download/v2.47.1.windows.1/PortableGit-2.47.1-64-bit.7z.exe',
      sha256: '4f3f21f4effcb659566883ee1ed3ae403e5b3d7a0699cee455f6cd765e1ac39c',
    }),
  }),
});

export const SUPPORTED_RUNTIME_TARGETS = Object.freeze(Object.keys(RUNTIME_ARTIFACTS));
