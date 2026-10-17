# Contributing

## Releasing the TypeScript package

1. Bump `version` in `typescript/package.json` and `typescript/package-lock.json`.
2. Commit that change on `main`.
3. Tag the commit `typescript-vX.Y.Z`. The version after `typescript-v` must equal `package.json` `version`.
4. Publish a GitHub Release for that tag.

The release runs [`.github/workflows/publish.yml`](.github/workflows/publish.yml), which tests the package and publishes `@cryptonly/x402` to npm.

## Releasing the Python package

1. Bump `version` in `python/pyproject.toml`.
2. Commit that change on `main`.
3. Tag the commit `python-vX.Y.Z`. The version after `python-v` must equal `pyproject.toml` `version`.
4. Publish a GitHub Release for that tag.

Before the first release, add a pending trusted publisher on PyPI for project `cryptonly-x402`: owner `cryptonly-net`, repository `x402`, workflow `publish.yml`.

The release runs the same workflow, which tests the package and publishes `cryptonly-x402` to PyPI.
