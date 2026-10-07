FROM node:22-bookworm-slim
WORKDIR /app
ENV NODE_ENV=production
# mediasoup (for "Help carry this call" from the server's own command line) builds a native worker.
RUN apt-get update && apt-get install -y --no-install-recommends python3 make g++ && rm -rf /var/lib/apt/lists/*
COPY package.json package-lock.json ./
RUN npm ci --omit=dev && npm cache clean --force
COPY . .
RUN mkdir -p /data && chown node:node /data
USER node
ENV PORT=8787 MEET_DB=/data/meet.db
EXPOSE 8787
HEALTHCHECK --interval=30s --timeout=5s CMD node -e "fetch('http://localhost:'+process.env.PORT+'/healthz').then(r=>process.exit(r.ok?0:1)).catch(()=>process.exit(1))"
CMD ["node", "bin/meet.mjs", "serve"]
