FROM node:22-alpine
WORKDIR /app
ENV NODE_ENV=production
COPY package.json package-lock.json ./
RUN npm ci --omit=dev && npm cache clean --force
COPY src ./src
COPY public ./public
RUN mkdir -p /app/data && chown node:node /app/data
ENV PORT=3000 HOST=0.0.0.0 DATA_DIR=/app/data
VOLUME ["/app/data"]
EXPOSE 3000
USER node
CMD ["node", "src/index.js"]
