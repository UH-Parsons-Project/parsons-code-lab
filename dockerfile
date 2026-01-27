FROM node:20

WORKDIR /app

COPY package*.json ./

RUN npm install

COPY . .

RUN chown -R 0:0 /app \
 && chmod -R a+rX /app \
 && chmod -R g+rwX /app/dist

RUN npm run build

# Set the port Node will listen on (must match OpenShift targetPort)
ENV PORT=8000
EXPOSE 8000

CMD ["npm", "run", "dev"]
