# hrock-web: the Hamilton Rock marketing site (Astro, static, deployed to Netlify).
# Node comes from mise.toml; `mise exec` makes sure recipes use it even where mise
# isn't activated in the shell.

export ASTRO_TELEMETRY_DISABLED := "1"

# Start the Astro dev server in the background on :4321 (https://www.mini.hrock.test
# via dev-proxy). `just logs` follows it, `just stop` ends it.
dev:
    #!/usr/bin/env bash
    set -euo pipefail
    if [ -f .dev.pid ] && kill -0 "$(cat .dev.pid)" 2>/dev/null; then
        echo "already running (pid $(cat .dev.pid))"; exit 0
    fi
    [ -d node_modules ] || mise exec -- npm install --no-fund --no-audit
    set -m  # own process group, so stop also ends the server's children
    nohup mise exec -- npx astro dev > .dev.log 2>&1 &
    echo $! > .dev.pid
    for _ in $(seq 1 30); do
        curl -fsS -o /dev/null http://127.0.0.1:4321/ 2>/dev/null && break
        kill -0 "$(cat .dev.pid)" 2>/dev/null || { cat .dev.log; rm -f .dev.pid; exit 1; }
        sleep 0.5
    done
    curl -fsS -o /dev/null http://127.0.0.1:4321/ || { cat .dev.log; just stop; exit 1; }
    echo "hrock-web on https://www.mini.hrock.test (http://localhost:4321, pid $(cat .dev.pid)); just logs to follow"

stop:
    #!/usr/bin/env bash
    [ -f .dev.pid ] || { echo "not running"; exit 0; }
    kill -- -"$(cat .dev.pid)" 2>/dev/null || true
    rm -f .dev.pid

logs:
    tail -f .dev.log

# No database: content is Markdown in src/content. Here so the repo meets the project contract.
seed:
    @echo "no database to seed"

# Production build into dist/, then compare every page with the scraped original.
build:
    mise exec -- npx astro build
    @if [ -d _scrape/pages ]; then mise exec -- node scripts/check.mjs; fi

# One-off capture of the live Webflow site into _scrape/ and public/. Re-runs only fetch
# what's missing. NODE_USE_ENV_PROXY makes Node's fetch honour HTTPS_PROXY when set.
scrape:
    NODE_USE_ENV_PROXY=1 mise exec -- node --no-warnings scripts/scrape.mjs

# One-off: regenerate src/ partials, data and FAQ Markdown from _scrape/. Overwrites
# hand edits to those files, so don't run it after the site has been edited.
convert:
    mise exec -- node scripts/convert.mjs
