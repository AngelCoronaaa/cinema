FROM node:22-alpine
WORKDIR /app

COPY package*.json ./
RUN npm ci --legacy-peer-deps && npm install react-is --legacy-peer-deps

COPY . .
RUN npm run build

ENV NODE_ENV=production \
    HOST=0.0.0.0 \
    PORT=3000 \
    STREAMBERT_DATA_DIR=/data

VOLUME /data
EXPOSE 3000
CMD ["node", "server/index.js"]
