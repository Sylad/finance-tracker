FROM node:20-alpine AS builder
WORKDIR /app
COPY package*.json ./
RUN npm ci
COPY . .
RUN npm run build
# Copy JSON assets not handled by tsc
RUN find /app/src -name '*.json' | while read f; do \
      dest="/app/dist${f#/app/src}"; \
      mkdir -p "$(dirname "$dest")"; \
      cp "$f" "$dest"; \
    done

FROM node:20-alpine
WORKDIR /app
# L185 — dépendances de production seules : l'étape finale ne reprend pas le
# node_modules du builder (jest, @nestjs/cli, typescript… y vivent). Le cache
# npm est vidé dans la même couche pour ne pas alourdir l'image.
COPY package*.json ./
RUN npm ci --omit=dev --no-audit --no-fund && npm cache clean --force
COPY --from=builder /app/dist ./dist
RUN mkdir -p data/uploads
CMD ["node", "dist/main"]
