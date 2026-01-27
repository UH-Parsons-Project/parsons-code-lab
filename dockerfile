FROM node:20

WORKDIR /app

COPY package*.json ./

RUN npm install

COPY . .

RUN npm run build

RUN chmod -R 777 /app/dist

ENV PORT=8000
EXPOSE 8000

CMD ["npx", "serve", "-s", "dist", "-l", "8000"]
