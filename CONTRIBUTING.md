# Contributing

## Development

```bash
npm install
npm run build
```

## Suggested workflow

1. Create a branch.
2. Make a focused change.
3. Run `npm run build`.
4. Test the CLI with `node dist/cli.js install --help`.
5. Open a pull request with clear notes.

## Coding notes

- Keep the CLI non-interactive and script-friendly.
- Prefer additive config updates over destructive rewrites.
- Keep deployment examples in sync with runtime options.
