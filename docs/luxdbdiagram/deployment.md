# Deploying LuxDBDiagram

LuxDBDiagram is a static web app: nginx serves the built files, and every diagram lives in the
visitor's own browser (IndexedDB). There is no backend, database or secret to deploy.

## Where it runs

| Part | Value |
| --- | --- |
| Image | `ghcr.io/luxforge-ltd/luxdbdiagram:<version>`, public, built on joyeuse |
| Platform | OpenRail on `openrail-trial` (VM 105, `10.10.180.5`) |
| OpenRail project | `luxdbdiagram`, environment `production` |
| App service | `web`: the image above, port 80, private name `web.internal` |
| Connector service | `cloudflared`: image `cloudflare/cloudflared:2026.11.2`, start command `tunnel --no-autoupdate run`, `TUNNEL_TOKEN` sealed in by `luxhome-cf-publish` |
| Internet name | `luxdbdiagram.luxforge.dev`, behind Cloudflare Access (`admin-only-access`) |
| LAN name | `luxdbdiagram.home.luxforge.dev`: LuxHome internal DNS and proxy, set up there, not by this runbook |

The project has its own Cloudflare tunnel whose connector runs inside the project, as the Pillars
standard "Publishing apps through Cloudflare" requires for apps on OpenRail. LuxHome's
`luxhome-cf-publish` creates the tunnel, the Access application, the route and the DNS record.

## Build and publish the image (joyeuse)

The image hides ChartDB Cloud prompts and turns off ChartDB's analytics by default, at build time
and in `/config.js`. Never pass `VITE_OPENAI_API_KEY` or `OPENAI_API_KEY`: the app would hand the
key to every visitor.

```powershell
docker build -t ghcr.io/luxforge-ltd/luxdbdiagram:<version> .
docker push ghcr.io/luxforge-ltd/luxdbdiagram:<version>
```

Pushing needs a GitHub login with the `write:packages` scope:

```powershell
gh auth refresh -h github.com -s write:packages
gh auth token | docker login ghcr.io -u (gh api user --jq .login) --password-stdin
```

The first push creates the package as private. Make it public once (package settings on GitHub),
so OpenRail can pull it without a registry credential.

## Create the OpenRail project (once)

1. New project `luxdbdiagram`.
2. Service `web` from the Docker image `ghcr.io/luxforge-ltd/luxdbdiagram:<version>`. Port 80.
   No domain: the tunnel reaches it as `http://web.internal:80`.
3. Service `cloudflared` from the Docker image `cloudflare/cloudflared:2026.11.2`, start command
   `tunnel --no-autoupdate run`. No variables: the publish command seals `TUNNEL_TOKEN` in.
4. Deploy, so nothing is left staged. Until the publish below, `cloudflared` fails for want of a
   token and stops after its restart limit; that is expected.

## Publish through Cloudflare

Run by the operator, who unlocks the vault (see LuxHome `docs/runbooks/cloudflare-publish.md`):

```powershell
luxhome-cf-publish --tunnel luxdbdiagram --dry-run publish luxdbdiagram --service http://web.internal:80 `
    --create-tunnel --openrail-service luxdbdiagram/cloudflared
luxhome-cf-publish --tunnel luxdbdiagram publish luxdbdiagram --service http://web.internal:80 `
    --create-tunnel --openrail-service luxdbdiagram/cloudflared
```

The publish is done when anonymous requests to `https://luxdbdiagram.luxforge.dev/` are answered
by the Access login.

## Check

- Anonymous: `curl -sI https://luxdbdiagram.luxforge.dev/` answers 302 to `*.cloudflareaccess.com`.
- Signed in through Access: the editor loads, `/config.js` shows `DISABLE_ANALYTICS: "true"` and
  `HIDE_CHARTDB_CLOUD: "true"`, and no request goes to `cdn.usefathom.com`.
- The header's GitHub button opens `LuxForge-ltd/LuxDBDiagram` (the AGPL source offer).

## Update to a new version

Build and push the new tag, change the `web` service's image tag in OpenRail and deploy. The
tunnel, Access and DNS do not change.

## Remove

1. `luxhome-cf-publish remove luxdbdiagram` (DNS first, then the route, then the Access app).
2. Delete the tunnel `luxdbdiagram` in Cloudflare Zero Trust.
3. Delete the OpenRail project `luxdbdiagram`.
4. Optionally delete the package versions on GitHub.

Diagrams are kept in each browser, per address: removing the site does not delete them, and
diagrams made at another address (for example a local dev server) do not appear here. Export them
as JSON or DBML to move them.
