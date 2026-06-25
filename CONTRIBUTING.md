# Contributing

Contributions are welcome via Issues and Pull Requests. Search existing ones before opening a new one.

## Commit messages

This repo uses [Conventional Commits](https://www.conventionalcommits.org/) — they drive automated versioning and the
changelog, so the format matters:

```text
<type>[optional scope]: <description>
```

| Type | Use for | Version bump |
| --- | --- | --- |
| `feat` | A new feature | minor (`1.0.0` → `1.1.0`) |
| `fix` | A bug fix | patch (`1.0.0` → `1.0.1`) |
| `docs`, `refactor`, `chore`, `ci`, `test` | Everything else | none |

Breaking changes use `!` (`feat!: ...`) or a `BREAKING CHANGE:` footer and trigger a major bump.

Only `feat`, `fix`, and breaking changes produce a release. If you squash-merge, the **PR title** becomes the commit
message, so it must follow this format too.

## Releases

Automated with [release-please](https://github.com/googleapis/release-please) — don't bump the version or edit
`CHANGELOG.md` by hand. Merging conventional commits to `main` opens a release PR; merging that PR tags, releases, and
publishes to npm.
