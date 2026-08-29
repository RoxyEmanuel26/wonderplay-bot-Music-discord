FROM node:20-alpine

# Set working directory
WORKDIR /usr/src/app

# Install build dependencies for Prisma and native modules
RUN apk add --no-cache openssl

# Copy package.json and package-lock.json
COPY package*.json ./

# Install all dependencies (including devDependencies for building)
RUN npm install

# Copy Prisma schema and generate client
COPY prisma ./prisma
RUN npx prisma generate

# Copy source code
COPY . .

# Build TypeScript code
RUN npm run build

# Remove devDependencies for smaller production image
RUN npm prune --production

# Expose web dashboard port (if any)
EXPOSE 3000

# Start the bot
CMD ["npm", "start"]
