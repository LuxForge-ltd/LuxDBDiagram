# LuxDBDiag GitHub service: Node runs the TypeScript sources directly (type stripping), and the
# service has no npm dependencies, so nothing is installed or built.
FROM node:24-alpine

LABEL org.opencontainers.image.source="https://github.com/LuxForge-ltd/LuxDBDiagram" \
      org.opencontainers.image.description="LuxDBDiag GitHub service: GitHub sign-in and DBML commits for LuxDBDiagram" \
      org.opencontainers.image.licenses="AGPL-3.0"

ENV NODE_ENV=production \
    PORT=8080

WORKDIR /app
COPY package.json ./
COPY src ./src

USER node
EXPOSE 8080

CMD ["node", "--disable-warning=ExperimentalWarning", "src/server.ts"]
