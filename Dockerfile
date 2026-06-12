FROM node:20-alpine
WORKDIR /app

# unzip is required by scripts/update-obsidian-mobile.js (extracts APK assets)
RUN apk add --no-cache unzip

# App source, scripts, and default vault
COPY src/ src/
COPY scripts/ scripts/
COPY user-data/ user-data/
COPY entrypoint.sh /entrypoint.sh

# Static assets served from the project root (favicon, touch icon)
COPY favicon.ico favicon.svg apple-touch-icon.png ./
RUN chmod +x /entrypoint.sh

# Install server dependencies (production only)
RUN cd src/server && npm ci --omit=dev

EXPOSE 3000

# HOST must be 0.0.0.0 inside a container
ENV HOST=0.0.0.0
ENV PORT=3000
ENV VAULT_PATH=user-data/demo-vault

# Obsidian renderer bundles are downloaded at first start into the
# obsidian_vendor volume (see docker-compose.yml). Network is available
# at runtime but not during `docker build`, so we can't download here.
ENTRYPOINT ["/entrypoint.sh"]
CMD ["node", "src/server/index.js"]
