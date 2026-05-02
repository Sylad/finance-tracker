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
COPY --from=builder /app/dist ./dist
COPY --from=builder /app/node_modules ./node_modules
COPY --from=builder /app/package.json ./
RUN mkdir -p data/uploads
CMD ["node", "dist/main"]
