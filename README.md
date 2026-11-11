# Renovate Manual Trigger GitHub Action

Trigger a Renovate Run for any repository with a GitHub Action.

## Compatibility

This action is compatible with these versions of Renovate:

- GitHub hosted Renovate (https://developer.mend.io)

## Usage

The target repository must have an open Dependency Dashboard issue with the
manual-run checkbox enabled. The token must have permission to read and update
issues in that repository. To renovate a different repository than the one the
workflow runs in, use a token with access to that repository.

```yaml
    steps:
      - name: Trigger Renovate
        uses: WhizUs/renovate-manual-trigger-github-action@v0.1.0
        with:
          token: ${{ secrets.ACCESS_TOKEN }}
          renovate-repository: org/repo
```

The action searches all pages of open issues for the dashboard. If the
manual-run checkbox is already checked, the issue is left unchanged. If the
dashboard or checkbox cannot be found, the action fails with an error.

## Development

Run the tests with Node.js 20 or later:

```sh
npm test
```
