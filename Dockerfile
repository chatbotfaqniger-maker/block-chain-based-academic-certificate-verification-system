FROM node:22-alpine AS build
WORKDIR /app
RUN apk add --no-cache openssl ffmpeg font-dejavu
COPY package*.json ./
RUN npm install
COPY . .
RUN npx hardhat compile && npm run build

FROM node:22-alpine AS runtime
ENV NODE_ENV=production
WORKDIR /app
RUN apk add --no-cache openssl ffmpeg font-dejavu
COPY package*.json ./
RUN npm install --omit=dev
COPY --from=build /app/server ./server
COPY --from=build /app/dist ./dist
COPY --from=build /app/artifacts ./artifacts
EXPOSE 8080
CMD ["node","server/index.js"]