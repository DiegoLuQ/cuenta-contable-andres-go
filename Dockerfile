# Cuentas Contables Softland — Web (Express: API + interfaz estática)
# Una sola etapa: no hay compilación (sin Next.js / bundler). Solo dependencias de producción.
FROM node:24-alpine

# tzdata: hora de Chile en los logs del contenedor
RUN apk add --no-cache tzdata
ENV TZ=America/Santiago \
    NODE_ENV=production \
    PORT=8000 \
    HOST=0.0.0.0

WORKDIR /app

# Dependencias (capa cacheable)
COPY package.json package-lock.json ./
RUN npm ci --omit=dev && npm cache clean --force

# Código de la aplicación (ver .dockerignore: no entran .env, extractor/, sql/, docs)
COPY --chown=node:node . .

# No ejecutar como root (la imagen oficial trae el usuario "node", uid 1000)
USER node

EXPOSE 8000

HEALTHCHECK --interval=30s --timeout=5s --start-period=15s --retries=3 \
  CMD wget -qO- http://127.0.0.1:8000/api/health > /dev/null || exit 1

CMD ["node", "server.js"]
