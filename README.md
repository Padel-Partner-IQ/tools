# Padel Partner IQ Tools

Browser tools for the Padel Partner IQ platform, published to
<https://padel-partner-iq.github.io/tools/>.

## This repository is generated

Nothing here is edited by hand. The contents are built in the `platform`
repository and published to this one by GitHub Actions on every push to
`platform`'s `main` branch.

**Any file you edit here will be silently overwritten by the next publish.**
The publishing workflow deletes the whole tree and replaces it with a freshly
built site, preserving only `.git`, `.github`, `.gitignore`, `README.md`,
`LICENSE` and `CNAME`. If a change you made survived, it was because it landed
in one of those, not because hand edits are supported.

To change a tool, change its source in `platform` and let the publish run.

## Where things are

| Concern | Location |
| --- | --- |
| Tool sources and site assembler | `platform` |
| Build command | `npm run build:tools-site` |
| Publishing workflow | `platform`, `.github/workflows/deploy-tools-site.yml` |
| Build provenance | [`version.json`](version.json) |

`version.json` records the version, the `platform` commit the site was built
from, and the build date, so a published site can always be traced back to its
source.

Architecture, the two-repository boundary and the publishing flow are
documented in the `docs` repository under `architecture/tools-site.md`. Both
`platform` and `docs` are private; the links above will not resolve without
access.

## Maintenance note

Publishing authenticates as the `padel-partner-iq-tools-publisher` GitHub App,
installed on this repository alone with permission to write contents and read
metadata. The workflow mints a token at the start of each run; it lasts an hour
and is never stored.

The stored credential is the app's private key, held as the
`TOOLS_PUBLISH_APP_PRIVATE_KEY` secret in `platform` alongside
`TOOLS_PUBLISH_APP_ID`. Unlike the personal access token this replaced, an app
private key does not expire, so publishing cannot lapse quietly during a period
when nobody is pushing.

If the site stops updating after a `platform` change, check that the app is
still installed on this repository and that both secrets are present, before
looking for a fault in the build.
