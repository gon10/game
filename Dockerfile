# Build stage
FROM node:20-alpine AS builder

WORKDIR /app

# Copy package files
COPY package*.json ./

# Install dependencies
RUN npm ci

# Copy source code
COPY . .

# Build the frontend
RUN npm run build

# Production stage
FROM node:20-alpine AS production

WORKDIR /app

# Copy package files
COPY package*.json ./

# Install only production dependencies + tsx for running server
RUN npm ci --omit=dev && npm install tsx

# Copy built frontend from builder stage
COPY --from=builder /app/dist ./dist

# Copy server source files (tsx runs TypeScript directly)
COPY server ./server
COPY src/types ./src/types
COPY tsconfig.json ./

# Expose ports
# 3001 - WebSocket game server
# 4173 - Vite preview server (serves built frontend)
EXPOSE 3001 4173

# Start both servers
CMD ["sh", "-c", "npx tsx server/index.ts & npx vite preview --host --port 4173"]
