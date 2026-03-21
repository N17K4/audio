# ── AI Workshop Frontend（Docker 用） ─────────────────────────────────────────
FROM node:20-alpine AS builder

WORKDIR /app

RUN npm install -g pnpm

COPY frontend/package.json frontend/pnpm-lock.yaml* ./

RUN pnpm install --frozen-lockfile 2>/dev/null || pnpm install

COPY frontend/ ./

RUN pnpm build

# ── nginx 托管静态文件 + API 反向代理 ─────────────────────────────────────────
FROM nginx:alpine

COPY --from=builder /app/out /usr/share/nginx/html
COPY docker/nginx.conf /etc/nginx/conf.d/default.conf

EXPOSE 80
