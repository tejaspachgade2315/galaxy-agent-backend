FROM node:22-alpine

WORKDIR /app

# Install openssl for Prisma
RUN apk add --no-cache openssl libc6-compat

# Pin pnpm to 10.10.0 for stable build execution
RUN corepack enable && corepack prepare pnpm@10.10.0 --activate

COPY package.json ./

RUN pnpm install

COPY prisma ./prisma
RUN npx prisma generate

COPY . .

EXPOSE 3001

CMD ["sh", "-c", "npx prisma db push && pnpm dev"]
