#!/bin/sh

# LuxDBDiagram: the optional GitHub service (services/github). With GITHUB_PROXY_URL set, for
# example http://github.internal:8080, requests to /api/github/ are passed to it and /config.js
# tells the app to show its GitHub features. Without it, /api/github/ answers 404 and the app
# works as before. The service's name is looked up per request, so nginx starts even when the
# service is not running.
GITHUB_SNIPPET=/etc/nginx/luxdbdiag/github.locations
mkdir -p /etc/nginx/luxdbdiag
GITHUB_PROXY_URL=$(printf '%s' "${GITHUB_PROXY_URL:-}" | sed 's:/*$::')
if [ -z "$GITHUB_PROXY_URL" ]; then
    export GITHUB_REPOS=false
    printf 'location /api/github/ {\n    return 404;\n}\n' > "$GITHUB_SNIPPET"
elif printf '%s' "$GITHUB_PROXY_URL" | grep -Eq '^https?://[A-Za-z0-9.-]+(:[0-9]{1,5})?$'; then
    export GITHUB_REPOS=true
    RESOLVER=${NGINX_RESOLVER:-$(awk '/^nameserver/ { print $2; exit }' /etc/resolv.conf)}
    RESOLVER=${RESOLVER:-127.0.0.11}
    case "$RESOLVER" in *:*) RESOLVER="[$RESOLVER]" ;; esac
    cat > "$GITHUB_SNIPPET" <<EOF
location /api/github/ {
    resolver ${RESOLVER} valid=10s ipv6=off;
    set \$luxdbdiag_github "${GITHUB_PROXY_URL}";
    proxy_pass \$luxdbdiag_github;
    proxy_http_version 1.1;
    proxy_read_timeout 60s;
    client_max_body_size 8m;
}
EOF
else
    echo "GITHUB_PROXY_URL must be http(s)://host[:port] with no path, for example http://github.internal:8080" >&2
    exit 1
fi

# Replace placeholders in nginx.conf
envsubst '${OPENAI_API_KEY} ${OPENAI_API_ENDPOINT} ${LLM_MODEL_NAME} ${HIDE_CHARTDB_CLOUD} ${DISABLE_ANALYTICS} ${GITHUB_REPOS}' < /etc/nginx/conf.d/default.conf.template > /etc/nginx/conf.d/default.conf

# Start Nginx
nginx -g "daemon off;"
