FROM node:20-alpine

WORKDIR /app

COPY package.json ./
RUN npm install --omit=dev && npm install nodemon --no-save

COPY . .

EXPOSE 4000

CMD ["node", "src/server.js"]
