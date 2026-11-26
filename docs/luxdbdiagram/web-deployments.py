#!/usr/bin/env python3
"""Show web's deployments and the staged changes of the linked OpenRail environment, stop web's old
version when an update waits for capacity, or discard a staged change.

Usage (from ~/deploy/luxdbdiagram):
  python3 web-deployments.py                     lists web's latest deployments and the staged changes
  python3 web-deployments.py --remove-active ID  removes web's active deployment ID, only while
                                                 another web deployment is waiting
  python3 web-deployments.py --discard ID        discards the staged change ID
Uses the OpenRail CLI's login (~/.config/openrail/config.json, or the file LUXRAIL_CONFIG names).
"""
import json, os, sys, urllib.error, urllib.request

BASE = "http://127.0.0.1:5050"


def main():
    args = sys.argv[1:]
    if args and not (len(args) == 2 and args[0] in ("--remove-active", "--discard")):
        sys.exit(__doc__)

    path = os.path.expanduser(os.environ.get("LUXRAIL_CONFIG") or "~/.config/openrail/config.json")
    config = json.load(open(path))
    token = config["instances"][BASE]
    link = config["links"].get(os.getcwd())
    if not link:
        sys.exit("This directory is not linked to an OpenRail project. Run this from ~/deploy/luxdbdiagram.")
    env = link["environment"]

    def call(method, api_path):
        request = urllib.request.Request(
            BASE + "/api/v1" + api_path,
            method=method,
            data=b"{}" if method == "POST" else None,
            headers={"Authorization": "Bearer " + token, "Content-Type": "application/json"},
        )
        try:
            with urllib.request.urlopen(request, timeout=30) as response:
                text = response.read()
                return json.loads(text) if text else None
        except urllib.error.HTTPError as error:
            sys.exit(f"{method} {api_path}: HTTP {error.code} {error.read()[:300].decode(errors='replace')}")

    def show():
        services = call("GET", f"/environments/{env}/canvas")["services"]
        web = next(service for service in services if service["config"].get("name") == "web")
        deployments = call("GET", f"/environments/{env}/services/{web['id']}/deployments?limit=3")
        changes = call("GET", f"/environments/{env}/changes")["changes"]
        print("web's latest deployments:")
        for d in deployments:
            print(f"  {d['id']}  {d['status']:<9} {'active' if d['active'] else '':<6} {(d.get('digest') or '')[:19]}")
        print("Staged changes:" if changes else "Staged changes: none")
        for c in changes:
            diff = ", ".join(f"{x['path']} {x.get('old')} -> {x.get('new')}" for x in c.get("diff") or [])
            print(f"  {c['id']}  {c.get('service')}  {c.get('kind')}  {diff}")
        return deployments, changes

    deployments, changes = show()
    if not args:
        return

    action, target = args
    if action == "--remove-active":
        old = next((d for d in deployments if d["id"] == target), None)
        if not old or not old["active"]:
            sys.exit(f"{target} is not web's active deployment. Nothing changed.")
        if not any(d["status"] == "DEPLOYING" and not d["active"] for d in deployments):
            sys.exit("No other web deployment is waiting, so removing the active one would only stop the site. Nothing changed.")
        call("POST", f"/deployments/{target}/remove")
        print(f"Asked OpenRail to remove {target}. The waiting deployment starts once its replica has stopped.")
    else:
        if not any(c["id"] == target for c in changes):
            sys.exit(f"{target} is not a staged change of this environment. Nothing changed.")
        call("DELETE", f"/environments/{env}/changes/{target}")
        print(f"Discarded {target}.")
    show()


if __name__ == "__main__":
    main()
