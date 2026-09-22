FROM node:22-alpine

WORKDIR /app

RUN apk add --no-cache python3 make g++ git bash curl

COPY package*.json ./
RUN npm install

COPY client/package*.json ./client/
RUN cd client && npm install

COPY . .
RUN cd client && npm run build

EXPOSE 9444

ENV PORT=9444
ENV NODE_ENV=production

CMD ["node", "server/index.js"]
