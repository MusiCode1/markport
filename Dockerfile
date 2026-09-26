# Self-hosted static build for the obsidian-vault-platform's Tier-A
# "obsidian-web serverless/OPFS" (plans/obsidian-vault-platform/SPEC.md §2/§4
# in grepleria/grepleria-configs). Reuses the SAME static-asset pipeline the
# Cloudflare Workers deployment uses (src/deployments/cloudflare/), because
# that's the ONLY deployment mode with NO server-side vault storage — vaults
# live entirely in browser OPFS (see src/deployments/cloudflare/README.md).
# That property is load-bearing: SPEC's storm table forbids a shared
# server-backed vault folder across 2+ browsers, and OPFS-only sidesteps the
# question by construction (nothing server-side to share).
#
# The Node.js server deployment (src/runtime-server/server/) is NOT used
# here -- it defaults new vaults to server-backed storage ('server' vault
# type, real filesystem), which is the Tier-B (single-writer Coder
# workspace) shape, not Tier-A (SPEC §1/§3).
#
# Stage 1 does the actual "proprietary renderer" pull: the official Obsidian
# Android APK, extracted + build-time-patched into vendor/obsidian-mobile/
# (scripts/update-obsidian-mobile.js) -- never committed to this repo
# (gitignored), never redistributed; it's baked into THIS image only, which
# is then pushed to the org's own artifact-keeper registry, never a public one.
FROM node:22-alpine AS builder
RUN apk add --no-cache unzip bash
WORKDIR /src
COPY . .
# Pulls + extracts + patches the Obsidian Android APK bundle into
# vendor/obsidian-mobile/ (network access to GitHub releases required).
RUN node scripts/update-obsidian-mobile.js
# build-assets.sh only shells out to `node -e` (built-ins) -- no `npm install`
# needed (that would also pull in wrangler, a deploy-only devDependency this
# self-hosted build never uses). Also pulls the LiveSync plugin release
# (network access to GitHub releases; WARNs and continues if unreachable --
# see build-assets.sh, this is not a hard build dependency).
RUN bash src/deployments/cloudflare/scripts/build-assets.sh

FROM nginx:1.27-alpine AS runtime
COPY --from=builder /src/.tmp/deployments/cloudflare/public /usr/share/nginx/html
COPY nginx.conf /etc/nginx/conf.d/default.conf
EXPOSE 80
