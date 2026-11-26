# Deploying LuxDBDiagram

LuxDBDiagram is a static web app: nginx serves the built files, and every diagram lives in the
visitor's own browser (IndexedDB). There is no database. The only backend part is the optional
GitHub service (see "GitHub service" below), which holds the only app secrets.

## Where it runs

| Part | Value |
| --- | --- |
| Image | `ghcr.io/luxforge-ltd/luxdbdiagram:<version>`, built on joyeuse, private (see below) |
| Platform | OpenRail on `openrail-trial` (VM 105, `10.10.180.5`), a Reserved deployment target in the Pillars Devices standard |
| OpenRail project | `luxdbdiagram`, environment `production` |
| App service | `web`: the image above (set by digest, see "Update to a new version"), port 80, private name `web.internal`, pulled with the registry credential `GHCR`, memory reservation 64 MB |
| Connector service | `cloudflared`: image `cloudflare/cloudflared:2026.11.2`, start command `tunnel --no-autoupdate run`, `TUNNEL_TOKEN` sealed in by `luxhome-cf-publish` |
| GitHub service (optional) | `github`: image `ghcr.io/luxforge-ltd/luxdbdiagram-github:<version>` (set by digest), port 8080, private name `github.internal`, memory reservation 96 MB; `web` reaches it through `GITHUB_PROXY_URL` (see "GitHub service" below). Deployed 2026-11-26 with the GitHub App `luxdbdiag` |
| Cloudflare | tunnel `luxdbdiagram`, route `luxdbdiagram.luxforge.dev` to `http://web.internal:80`, Access app with the shared policy `admin-only-access` |
| Internet name | `https://luxdbdiagram.luxforge.dev`, behind Cloudflare Access |
| LAN name | `luxdbdiagram.home.luxforge.dev` is not set up: it would be LuxHome internal DNS and proxy work |

The project has its own Cloudflare tunnel whose connector runs inside the project, as the Pillars
standard "Publishing apps through Cloudflare" requires for apps on OpenRail: OpenRail publishes no
host ports and its proxy redirects port 80 to HTTPS, so a connector on the host cannot reach the app.

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

The package stays private: GitHub links it to this repository through the image's source label and
does not allow a package linked to a fork to be made public. OpenRail pulls it with the install's
registry credential `GHCR` (server `ghcr.io`, a classic GitHub token with only `read:packages`,
created by the operator, who also renews it before it expires).

## OpenRail (OpenRail CLI on VM 105)

The OpenRail CLI (`5050`) runs on the VM over SSH (`ssh ben@10.10.180.5`). Log it in once with a
device code, which the operator approves in a browser signed in to the console; the token stays in
`~/.config/openrail` on the VM:

```bash
5050 login --browserless http://127.0.0.1:5050
# approve at https://openrail.luxforge.dev/cli-auth?code=<code>
```

Create the project (once), from a directory the CLI links to it:

```bash
mkdir -p ~/deploy/luxdbdiagram && cd ~/deploy/luxdbdiagram
5050 init -n luxdbdiagram -y
5050 add --image cloudflare/cloudflared:2026.11.2 -y
5050 environment edit --service-config cloudflared deploy.startCommand "tunnel --no-autoupdate run" -y
5050 add --image ghcr.io/luxforge-ltd/luxdbdiagram:<version> -y
5050 service rename web -s luxdbdiagram -y
5050 environment edit --service-config web source.registryCredential <id of the GHCR credential> -y
5050 environment edit --service-config web deploy.memoryReservationMb 64 -y
```

OpenRail sets aside 256 MB on the host for each replica unless `deploy.memoryReservationMb` (or a
memory limit) says otherwise, and during an update the old and new replicas run side by side. nginx
serving the app uses about 5 MB, so `web` reserves 64 MB; with the default, an update can wait with
"Pending: no capacity" on a host whose memory is mostly reserved but unused.

A service uses a registry credential only when its `source.registryCredential` names the
credential's id (Settings > Registry credentials, or `GET /api/v1/registry-credentials`); OpenRail
does not match credentials by server. Without it the deploy fails with "The registry refused
access". Until the publish below, `cloudflared` fails for want of a token and stops after its
restart limit; that is expected. Leave nothing staged: the publish command refuses to run while
the environment has staged changes for other services.

## Publish through Cloudflare (operator's machine)

The command creates the tunnel if needed, the Access app, the route, seals the connector token into
`cloudflared`, waits for the connector, then creates the DNS record and checks it anonymously. It
asks for the KeePassXC vault password (see LuxHome `docs/runbooks/cloudflare-publish.md`):

```powershell
& 'L:\LuxForge\bin\luxhome-cf-publish.ps1' --tunnel luxdbdiagram --dry-run publish luxdbdiagram --service http://web.internal:80 --create-tunnel --openrail-service luxdbdiagram/cloudflared
& 'L:\LuxForge\bin\luxhome-cf-publish.ps1' --tunnel luxdbdiagram publish luxdbdiagram --service http://web.internal:80 --create-tunnel --openrail-service luxdbdiagram/cloudflared
& 'L:\LuxForge\bin\luxhome-cf-publish.ps1' check luxdbdiagram
```

Do not look the name up before the DNS record exists: resolvers cache the "no such name" answer for
up to 30 minutes (the zone's negative TTL), and the command's anonymous check then ends `UNVERIFIED`
until the cache expires. Run `check` again after that.

## Check

- Anonymous: `/`, `/config.js` and any deep link answer 302 to `*.cloudflareaccess.com`.
- Signed in through Access: the editor loads, `/config.js` shows `DISABLE_ANALYTICS: "true"` and
  `HIDE_CHARTDB_CLOUD: "true"`, and no request goes to `cdn.usefathom.com`.
- The header's GitHub button opens `LuxForge-ltd/LuxDBDiagram` (the AGPL source offer).
- Inside the project: `wget -qO- http://web.internal/config.js` from the `web` container
  (`sudo docker exec` on the VM) answers with the flags above.

## Update to a new version

Build and push the new tag on joyeuse; `docker push` ends by printing the image's digest. Then on
the VM, set the image by that digest, so the service names exactly the build that runs:

```bash
cd ~/deploy/luxdbdiagram
5050 environment edit --service-config web source.image ghcr.io/luxforge-ltd/luxdbdiagram@sha256:<digest> -y
5050 service list
```

Wait until `web` is `online` before changing anything else on the service. While a deployment is
still pending, a change to other settings (for example `deploy.*`) starts a new deployment that
reuses the active deployment's image, so the old version comes back although the service shows the
new image. If that happens, set `source.image` again to a different reference to the same build
(the digest form instead of the tag, or the other way round): a change of image makes OpenRail fetch
it again. Check what runs from inside the project (see Check above): the page title is
"LuxForge Database Diagrams built on ChartDB".

The tunnel, Access and DNS do not change.

## GitHub service (optional)

The `github` service lets the app open a folder of a GitHub repository and commit changed DBML files
to a working branch (see "A GitHub repository" in [architecture.md](architecture.md)). It runs in the
same OpenRail project and is reached only through `web`'s nginx at `/api/github/`, so it sits behind
the same Cloudflare Access app with no route, DNS name or tunnel change.

### The GitHub App (operator)

Create it under the organisation: <https://github.com/organizations/LuxForge-ltd/settings/apps/new>.

| Setting | Value |
| --- | --- |
| GitHub App name | for example `LuxDBDiag LuxForge` (must be unique on GitHub) |
| Homepage URL | `https://luxdbdiagram.luxforge.dev` |
| Callback URL (some versions of the form label it Redirect URL) | `https://luxdbdiagram.luxforge.dev/api/github/callback` |
| Expire user authorization tokens | on |
| Request user authorization (OAuth) during installation | off |
| Enable Device Flow | off |
| Webhook | Active off |
| Repository permissions | Contents: Read and write; Pull requests: Read and write; Metadata: Read-only (set automatically) |
| Organization and account permissions | none |
| Where can this GitHub App be installed? | Only on this account |

Then generate a client secret (no private key is needed). Install the App with **Only select
repositories**, choosing the repositories the app may open (for example `Grassroots-Admin-Portal`).
Note the App's client ID and URL name (the part after `github.com/apps/`).

Copy the Access application's audience (AUD) tag from Cloudflare Zero Trust, Access, Applications,
`luxdbdiagram`. It is not secret. If the dashboard does not show it, sign in to
`https://luxdbdiagram.luxforge.dev`, open the browser's developer console there and run:

```js
(() => { const c = (document.cookie.match(/CF_Authorization=([^;]+)/) || [])[1] || prompt('Paste the CF_Authorization cookie value'); return JSON.parse(atob(c.split('.')[1].replace(/-/g, '+').replace(/_/g, '/'))).aud; })()
```

If the cookie cannot be read from the page, the snippet asks for its value: copy it from the
developer tools (Application, Cookies). The snippet prints only the `aud` claim. The cookie itself
is a sign-in token: never paste it anywhere else.

### Build and add the service

On joyeuse:

```powershell
docker build -t ghcr.io/luxforge-ltd/luxdbdiagram-github:<version> -f services/github/Dockerfile services/github
docker push ghcr.io/luxforge-ltd/luxdbdiagram-github:<version>
```

On the VM (`cd ~/deploy/luxdbdiagram`):

```bash
5050 add --image ghcr.io/luxforge-ltd/luxdbdiagram-github@sha256:<digest> -y
5050 service rename github -s luxdbdiagram-github -y
5050 environment edit --service-config github source.registryCredential <id of the GHCR credential> -y
5050 environment edit --service-config github deploy.memoryReservationMb 96 -y
5050 environment edit --service-config github deploy.healthcheckPath /api/github/health -y
5050 variables set -s github PUBLIC_URL=https://luxdbdiagram.luxforge.dev \
  ACCESS_TEAM_DOMAIN=<team>.cloudflareaccess.com ACCESS_AUD=<AUD tag> \
  GITHUB_CLIENT_ID=<client ID> GITHUB_APP_SLUG=<App URL name> -y
head -c 32 /dev/urandom | base64 | python3 seal-var.py github SESSION_KEY
5050 variables set -s web GITHUB_PROXY_URL=http://github.internal:8080 -y
```

The two secrets are sealed. The CLI's `variables set` stores plain variables, so they go in with
[seal-var.py](seal-var.py): copy it to `~/deploy/luxdbdiagram` on the VM and run it from there. It
uses the CLI's login to save the variable as sealed through OpenRail's API, then commits and deploys
the change. It refuses to run while other services have staged changes, and
`python3 seal-var.py --check SERVICE NAME` checks everything without changing anything.

The operator seals the client secret themselves: `python3 seal-var.py github GITHUB_CLIENT_SECRET`,
then paste the secret at the hidden prompt and press Enter. It never appears on screen or in shell
history. `SESSION_KEY` is generated on the VM and never shown; changing it signs everyone out of
GitHub. Wait for each service to be `online` before the next change (see "Update to a new version").

Until every setting is present the service runs and `/api/github/status` lists what is missing.
`ALLOW_WITHOUT_ACCESS=true` switches the Access check off and is for local development only.

### Check the GitHub service

- Inside the project: `wget -qO- http://github.internal:8080/api/github/health` from the `web`
  container answers `{"ok":true}`; `wget -qO- http://web.internal/config.js` shows
  `GITHUB_REPOS: "true"`.
- Without an Access token the service refuses everything but `health`:
  `wget -qO- http://github.internal:8080/api/github/status` answers 403.
- Signed in through Access: `https://luxdbdiagram.luxforge.dev/api/github/status` shows
  `"configured":true`.

### Remove the GitHub service

Delete the `web` variable `GITHUB_PROXY_URL` (the app hides its GitHub features), delete the
`github` service, and uninstall or delete the GitHub App.

## Remove

1. `& 'L:\LuxForge\bin\luxhome-cf-publish.ps1' remove luxdbdiagram` (DNS first, then the route,
   then the Access app).
2. Delete the tunnel `luxdbdiagram` in Cloudflare Zero Trust.
3. Delete the OpenRail project `luxdbdiagram`, and the registry credential `GHCR` if nothing else
   uses it.
4. Optionally delete the package versions on GitHub and revoke the `read:packages` token.

Diagrams are kept in each browser, per address: removing the site does not delete them, and
diagrams made at another address (for example a local dev server) do not appear here. Export them
as JSON or DBML to move them.
