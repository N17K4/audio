# ── AI Workshop Frontend 開発用 ───────────────────────────────────────────────
FROM node:20-alpine

WORKDIR /app

RUN npm install -g pnpm

# package.json だけ先にコピーして依存インストール（キャッシュ効率化）
COPY frontend/package.json frontend/pnpm-lock.yaml* ./

RUN pnpm install

EXPOSE 3000

CMD ["pnpm", "dev", "--hostname", "0.0.0.0", "--port", "3000"]
