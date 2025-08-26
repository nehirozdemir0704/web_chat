# Backend Dockerfile
FROM node:18-alpine
WORKDIR /app
COPY backend/package*.json ./
RUN npm install
COPY frontend/public ./frontend/public
COPY backend/. .
EXPOSE 3000
CMD ["node", "server.js"] 