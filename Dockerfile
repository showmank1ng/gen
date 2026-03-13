FROM node:18-slim

WORKDIR /app

COPY package*.json ./

RUN npm install && \
    npm install discord.js-selfbot-v13@latest

COPY . .

EXPOSE 3000

CMD ["node", "index.js"]