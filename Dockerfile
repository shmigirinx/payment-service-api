FROM node:22-bookworm-slim AS base
WORKDIR /app
RUN apt-get update \
    && apt-get install -y --no-install-recommends openssl \
    && rm -rf /var/lib/apt/lists/*

FROM base AS build
COPY package*.json ./
COPY prisma ./prisma
RUN npm ci
RUN npm run prisma:generate
COPY tsconfig*.json ./
COPY jest.config.cjs ./
COPY src ./src
COPY test ./test
RUN npm run build

FROM build AS production-deps
RUN npm prune --omit=dev

FROM base AS runtime
ENV NODE_ENV=production
COPY --from=production-deps /app/node_modules ./node_modules
COPY --from=build /app/package*.json ./
COPY --from=build /app/dist ./dist
COPY --from=build /app/prisma ./prisma
USER node
EXPOSE 3000
CMD ["sh", "-c", "npm run db:deploy && npm start"]
