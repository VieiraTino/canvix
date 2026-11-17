# [VDS] Imagem do Canvix para a Viagem de Sonho.
# Contexto de build: a raiz do repositorio (ramo vds, que ja traz as nossas
# alteracoes como commits). Build completo, mantem node_modules para correr o
# db:setup dentro do contentor. As fontes da marca vao para o sistema, para o
# PNG/JPG exportado no servidor (sharp/fontconfig) sair com Vogun/Montserrat.
FROM node:22-bookworm-slim
RUN apt-get update && apt-get install -y --no-install-recommends \
      fontconfig openssl ca-certificates bash \
    && rm -rf /var/lib/apt/lists/*
# deploy/fonts/ nao esta em git (licencas): copiar para la os ficheiros antes do build
COPY deploy/fonts/ /usr/local/share/fonts/vds/
RUN fc-cache -f && (fc-list | grep -iE "vogun|montserrat" | head -3 || echo "aviso: fontes da marca em falta em deploy/fonts/")
WORKDIR /app
COPY package.json package-lock.json ./
COPY prisma ./prisma
COPY scripts ./scripts
RUN npm ci --no-audit --no-fund
COPY . ./
ENV NEXT_TELEMETRY_DISABLED=1
RUN npm run build
ENV NODE_ENV=production HOSTNAME=0.0.0.0 PORT=3000
EXPOSE 3000
CMD ["node", ".next/standalone/server.js"]
