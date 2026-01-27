FROM node:20

WORKDIR /app

COPY package*.json ./

RUN npm install

COPY . .

RUN mkdir -p /app/dist && chmod -R 777 /app/dist

RUN npm run build

RUN chown -R 0:0 /app && \
    chmod -R a+rX /app && \
    chmod -R g+rwX /app/dist

# Set the port Node will listen on (must match OpenShift targetPort)
ENV PORT=8000
EXPOSE 8000

CMD ["npm", "run", "dev"]
