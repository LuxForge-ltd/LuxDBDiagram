FROM node:24-alpine AS builder

ARG VITE_OPENAI_API_KEY
ARG VITE_OPENAI_API_ENDPOINT
ARG VITE_LLM_MODEL_NAME
# LuxDBDiagram: hide ChartDB Cloud prompts and ChartDB's analytics unless a build asks for them.
ARG VITE_HIDE_CHARTDB_CLOUD=true
ARG VITE_DISABLE_ANALYTICS=true

WORKDIR /usr/src/app

COPY package.json package-lock.json ./

RUN npm ci

COPY . .

RUN echo "VITE_OPENAI_API_KEY=${VITE_OPENAI_API_KEY}" > .env && \
    echo "VITE_OPENAI_API_ENDPOINT=${VITE_OPENAI_API_ENDPOINT}" >> .env && \
    echo "VITE_LLM_MODEL_NAME=${VITE_LLM_MODEL_NAME}" >> .env && \
    echo "VITE_HIDE_CHARTDB_CLOUD=${VITE_HIDE_CHARTDB_CLOUD}" >> .env && \
    echo "VITE_DISABLE_ANALYTICS=${VITE_DISABLE_ANALYTICS}" >> .env

RUN npm run build

FROM nginx:stable-alpine AS production

LABEL org.opencontainers.image.source="https://github.com/LuxForge-ltd/LuxDBDiagram" \
      org.opencontainers.image.description="LuxDBDiagram, a fork of ChartDB with Areas, Dupes and Floats" \
      org.opencontainers.image.licenses="AGPL-3.0"

# Runtime defaults written into /config.js, which the app reads before the build-time values.
ENV HIDE_CHARTDB_CLOUD=true \
    DISABLE_ANALYTICS=true

COPY --from=builder /usr/src/app/dist /usr/share/nginx/html
COPY ./default.conf.template /etc/nginx/conf.d/default.conf.template
COPY entrypoint.sh /entrypoint.sh
# Strip CRLF in case the repo was checked out on Windows (#1126)
RUN sed -i 's/\r$//' /entrypoint.sh && chmod +x /entrypoint.sh

EXPOSE 80

ENTRYPOINT ["/entrypoint.sh"]