FROM node:20-alpine

WORKDIR /app

COPY package*.json ./
RUN npm ci

COPY . .
RUN npm run build

EXPOSE 9200

ENV NODE_ENV=production \
    EXEC_STREAM_PORT=9200 \
    EXEC_STREAM_TOKEN_EXPIRY=172800

CMD ["node", "dist/standalone.js"]
