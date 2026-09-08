FROM node:20-alpine AS builder
WORKDIR /app
COPY package*.json ./
# npm bug optional deps : lock généré sous glibc (WSL) → binaire rollup musl
# absent sous Alpine. On l'installe explicitement à la version de rollup.
RUN npm ci && npm i --no-save @rollup/rollup-linux-x64-musl@"$(node -p "require('rollup/package.json').version")"
COPY . .
RUN npm run build

FROM nginx:alpine
COPY --from=builder /app/dist /usr/share/nginx/html
COPY nginx.conf /etc/nginx/conf.d/default.conf
EXPOSE 80
