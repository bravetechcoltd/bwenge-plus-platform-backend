FROM node:22-alpine

RUN apk add --no-cache openssl

WORKDIR /app

COPY package*.json ./

# Install all deps (typescript is in dependencies, so this covers everything)
RUN npm install

COPY tsconfig.json ./
COPY . .

RUN npm run build

EXPOSE 3003

CMD ["node", "dist/index.js"]