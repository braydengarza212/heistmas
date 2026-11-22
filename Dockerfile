# Heistmas: game website + game server in one container.
#   docker build -t heistmas .
#   docker run -p 8080:8080 -v heistmas-data:/data --env-file .env heistmas
# (Railway: attach a volume at /data in the service settings.)
FROM node:22-slim
WORKDIR /app
COPY package.json package-lock.json ./
RUN npm ci
COPY . .
RUN npm run build
ENV NODE_ENV=production PORT=8080 DATA_DIR=/data
EXPOSE 8080
CMD ["npm", "start"]
