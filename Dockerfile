FROM node:24-alpine

WORKDIR /app

COPY package.json ./
COPY index.html styles.css app.js server.js ./

ENV NODE_ENV=production
ENV PORT=8080

EXPOSE 8080

CMD ["node", "server.js"]
