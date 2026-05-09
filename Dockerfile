FROM node:20-slim

WORKDIR /app

# Copy package files
COPY package*.json ./

# Install ALL deps including devDependencies (needed for TypeScript compiler)
RUN npm ci

# Copy source files
COPY . .

# Build TypeScript
RUN npm run build

# Remove dev dependencies after build
RUN npm prune --omit=dev

# Run the server
ENTRYPOINT ["node", "dist/index.js"]
