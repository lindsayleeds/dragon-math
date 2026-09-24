FROM node:22-bookworm-slim AS build

WORKDIR /app

COPY package.json package-lock.json ./
RUN npm ci

COPY . .

ARG DM_COMMIT=unknown
ARG DM_COMMIT_DATE
ARG VITE_GOOGLE_OAUTH_CLIENT_ID
ARG VITE_APPLE_SERVICES_ID
ARG VITE_APPLE_REDIRECT_URI
ENV DM_COMMIT=${DM_COMMIT}
ENV DM_COMMIT_DATE=${DM_COMMIT_DATE}
ENV VITE_GOOGLE_OAUTH_CLIENT_ID=${VITE_GOOGLE_OAUTH_CLIENT_ID}
ENV VITE_APPLE_SERVICES_ID=${VITE_APPLE_SERVICES_ID}
ENV VITE_APPLE_REDIRECT_URI=${VITE_APPLE_REDIRECT_URI}
RUN npm run build && npm prune --omit=dev

FROM node:22-bookworm-slim AS runtime

WORKDIR /app
ENV NODE_ENV=production
ENV API_HOST=0.0.0.0
ENV API_PORT=8080

COPY --from=build --chown=node:node /app/node_modules ./node_modules
COPY --from=build --chown=node:node /app/package.json ./package.json
COPY --from=build --chown=node:node /app/server ./server
COPY --from=build --chown=node:node /app/public ./public
COPY --from=build --chown=node:node /app/dist ./dist

USER node
EXPOSE 8080

CMD ["node", "server/index.js"]
