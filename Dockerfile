FROM node:20-alpine
WORKDIR /app
COPY package*.json ./
RUN npm install --omit=dev 2>/dev/null || true
COPY . .
RUN mkdir -p memory
EXPOSE 4321
CMD ["node", "server.js"]
