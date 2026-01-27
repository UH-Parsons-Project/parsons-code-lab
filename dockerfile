FROM node:20
WORKDIR /app

# Fix npm cache permissions for OpenShift random user
ENV NPM_CONFIG_CACHE=/tmp/.npm

# Copy package files and install dependencies
COPY package*.json ./
RUN npm install

# Copy source code and build
COPY . .
RUN npm run build

# Fix permissions for OpenShift (runs as random user)
RUN chmod -R g=u /app && \
    chgrp -R 0 /app

# Serve the built static files
ENV PORT=8000
EXPOSE 8000
CMD ["npx", "serve", "-s", "dist", "-l", "8000"]
