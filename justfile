# The project contract (dotfiles: project-contract.yaml). Starter stubs:
# replace each one once the stack is chosen.

dev:
    @echo "dev: not built yet; the stack is chosen in planning (onboard:stub)" >&2; exit 1

stop:
    @echo "stop: not built yet; the stack is chosen in planning (onboard:stub)" >&2; exit 1

seed:
    @echo "seed: not built yet; the stack is chosen in planning (onboard:stub)" >&2; exit 1

# One-off capture of the live Webflow site into _scrape/ and public/. Re-runs only fetch
# what's missing. NODE_USE_ENV_PROXY makes Node's fetch honour HTTPS_PROXY when set.
scrape:
    NODE_USE_ENV_PROXY=1 node --no-warnings scripts/scrape.mjs
