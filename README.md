# Ripple — PR risk gate

[![GitHub](https://img.shields.io/badge/GitHub-ripple--action-181717?logo=github&style=for-the-badge)](https://github.com/alimaandev/ripple-action)
[![Marketplace](https://img.shields.io/badge/GitHub%20Actions-Marketplace-2088FF?logo=githubactions&style=for-the-badge)](https://github.com/marketplace?query=ripple)
[![License: MIT](https://img.shields.io/github/license/alimaandev/ripple-action?style=for-the-badge)](LICENSE)

**Ripple is the CI gate that knows the blast radius — every PR is
risk-scored before AI (or anyone) breaks your codebase.**

This action runs [Ripple](https://github.com/alimaandev/ripple)'s diff gate
on every pull request. Every changed source file is scored for blast radius
(how many files, routes, tests and components depend on it), and the job
fails when any change crosses the gate — while `::error`/`::warning`
annotations appear directly on the PR's Files tab.

## Usage

```yaml
name: Ripple
on: pull_request

jobs:
  ripple:
    runs-on: ubuntu-latest
    permissions:
      contents: read
    steps:
      - uses: actions/checkout@v4
        with:
          fetch-depth: 0
      - uses: alimaandev/ripple-action@v1
```

That's it. The gate fails the job (`exit 1`) when the change set is risky,
annotates the offending files on the PR, and writes a job summary with the
full breakdown.

### SARIF → Code Scanning

The action writes `ripple.sarif` (SARIF 2.1.0) by default. Feed it to
[Code Scanning](https://docs.github.com/en/code-security/code-scanning)
with the official uploader:

```yaml
      - uses: alimaandev/ripple-action@v1

      - uses: actions/upload-sarif@v3
        if: always()
        with:
          sarif_file: ripple.sarif
```

### Tuning the gate

```yaml
      - uses: alimaandev/ripple-action@v1
        with:
          gate: critical   # medium | high | critical (default high)
          base: main       # git ref to diff against (default auto-detected)
          allow: |
            src/legacy/**
            src/generated/**
```

## Inputs

| Input           | Default     | Description                                                              |
| --------------- | ----------- | ------------------------------------------------------------------------ |
| `version`       | `latest`    | Ripple npm version to run (dist-tag or exact version). Pin for stability |
| `base`          | _(auto)_    | Git ref to diff against (`origin/main`, `main`, `HEAD~1` are tried)      |
| `gate`          | `high`      | Risk level that blocks: `medium`, `high`, `critical`                     |
| `allow`         | _(empty)_   | Newline-separated globs of changed files that never block the gate       |
| `annotate`      | `true`      | Emit `::error`/`::warning` annotations on the PR Files tab               |
| `upload-sarif`  | `true`      | Write a SARIF 2.1.0 report for Code Scanning                             |
| `sarif-path`    | `ripple.sarif` | Where to write the SARIF report                                       |

## Outputs

| Output          | Description                                             |
| --------------- | ------------------------------------------------------- |
| `blocked`       | `true` when the change set is at or above the gate      |
| `gate-level`    | The gate level used                                     |
| `verdict`       | `pass` or `block`                                       |
| `counts`        | JSON: `{"low":n,"medium":n,"high":n,"critical":n}`      |
| `changed-files` | Number of changed files in the change set               |
| `sarif-path`    | Path of the SARIF report                                |

## How it works

The action shells out to `npx @alimaandev/ripple diff` (JSON contract) and
derives annotations, the job summary and outputs from the report — the same
binary, the same verdict as running `ripple diff` locally. No tokens are
required: annotations, summaries and the exit code all work on a
`contents: read` permission. The SARIF file is produced from the same run
for the uploader to pick up.

## Risk scoring

Ripple scores every changed file 0–100 from its blast radius: number of
affected files, entry points, shared utilities, public exports, tests,
routes, and circular-dependency membership. Levels: `LOW` (0–29),
`MEDIUM` (30–54), `HIGH` (55–79), `CRITICAL` (80–100). Thresholds and
weights are configurable in `ripple.config.*` — see the
[Ripple README](https://github.com/alimaandev/ripple).

## License

MIT — see [LICENSE](LICENSE).
