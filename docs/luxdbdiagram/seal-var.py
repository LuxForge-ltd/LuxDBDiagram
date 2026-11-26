#!/usr/bin/env python3
"""Seal one variable into a service of the linked OpenRail project, then commit and deploy.

Usage (from ~/deploy/luxdbdiagram):
  python3 seal-var.py SERVICE NAME          asks for the value (hidden), seals it and deploys
  python3 seal-var.py --check SERVICE NAME  asks for the value and checks everything, changes nothing
The value is never shown or printed. Paste it at the prompt and press Enter.
When standard input is not a terminal, the value is read from it instead.
Uses the OpenRail CLI's login.
"""
import getpass, json, os, sys, urllib.error, urllib.request


def say(text):
    print(text, flush=True)


def main():
    args = sys.argv[1:]
    check = bool(args) and args[0] == "--check"
    if check:
        args = args[1:]
    if len(args) != 2:
        sys.exit(__doc__)
    service_name, name = args

    if sys.stdin.isatty():
        value = getpass.getpass(f"Paste the value for {name} (it will not show), then press Enter: ")
    else:
        value = sys.stdin.read()
    value = value.replace("\x1b[200~", "").replace("\x1b[201~", "").strip()
    if not value:
        sys.exit("No value given. Nothing changed.")
    say(f"Got a value of {len(value)} characters.")

    config = json.load(open(os.path.expanduser("~/.config/openrail/config.json")))
    base = "http://127.0.0.1:5050"
    token = config["instances"][base]
    link = config["links"].get(os.getcwd())
    if not link:
        sys.exit("Run this from the linked project folder (~/deploy/luxdbdiagram). Nothing changed.")
    env = link["environment"]

    def call(method, path, body=None):
        data = None if body is None else json.dumps(body).encode()
        request = urllib.request.Request(base + "/api/v1" + path, data=data, method=method,
            headers={"Authorization": "Bearer " + token, "Content-Type": "application/json"})
        try:
            with urllib.request.urlopen(request, timeout=30) as response:
                text = response.read()
                return json.loads(text) if text else None
        except urllib.error.HTTPError as error:
            detail = error.read().decode(errors="replace")[:300].replace(value, "<hidden>")
            sys.exit(f"OpenRail refused {method} {path}: {error.code} {detail}")
        except (urllib.error.URLError, TimeoutError) as error:
            sys.exit(f"Could not reach OpenRail at {base}: {error}")

    say("Checking the project...")
    canvas = call("GET", f"/environments/{env}/canvas") or {}
    matches = [s for s in canvas.get("services") or [] if (s.get("config") or {}).get("name") == service_name]
    if len(matches) != 1:
        sys.exit(f"Expected one service named {service_name}, found {len(matches)}. Nothing changed.")
    service_id = matches[0]["id"]
    staged = (call("GET", f"/environments/{env}/changes") or {}).get("changes") or []
    others = [c for c in staged if c.get("serviceId") != service_id]
    if others:
        sys.exit("Other services have staged changes; commit or discard them first. Nothing changed.")
    if check:
        say(f"Check passed: found {service_name} and nothing else is staged. Nothing changed.")
        return

    say(f"Saving {name} as a sealed variable...")
    call("PUT", f"/environments/{env}/services/{service_id}/variables", {"set": {name: value}, "seal": [name]})
    say("Committing and deploying...")
    call("POST", f"/environments/{env}/changes/commit", {"message": f"Seal {name} into {service_name}", "deploy": True})
    say(f"Done: {name} is sealed into {service_name}, which is redeploying (about a minute).")


try:
    main()
except KeyboardInterrupt:
    sys.exit("\nStopped. Nothing changed unless it said 'Saving' above.")
