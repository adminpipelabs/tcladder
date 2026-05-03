FROM node:20-alpine
WORKDIR /app
RUN apk add --no-cache python3 make g++
COPY package*.json ./
RUN npm ci --omit=dev
COPY src/ ./src/
EXPOSE 3500
CMD ["node", "src/app.js"]
