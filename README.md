# Renovate Manual Trigger GitHub Action

Trigger a Renovate Run for any repository with a GitHub Action.

## Compatibility

This action is compatible with these versions of Renovate:

- GitHub hosted Renovate (https://developer.mend.io)

## Usage

If you want to renovate a different repo than the one the workflow runs in,
you need to use a specific api token with the relevant permissions.

```yaml
    steps:
      - name: Trigger Renovate
        uses: WhizUs/renovate-manual-trigger-github-action@v0.1.0
        with:
          token: ${{ secrets.ACCESS_TOKEN }}
          renovate-repository: org/repo
```
