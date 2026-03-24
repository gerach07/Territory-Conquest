# Use Node.js LTS
FROM node:18-alpine AS production

# Set working directory
WORKDIR /app

# Set production environment
ENV NODE_ENV=production

# Copy package files first for better Docker layer caching
COPY package.json ./

# Install production dependencies only (package-lock.json optional)
RUN if [ -f package-lock.json ]; then npm ci --omit=dev; else npm install --omit=dev; fi && npm cache clean --force

# Copy server source
COPY server.js ./
COPY src/ ./src/

# Create non-root user for security
RUN addgroup -g 1001 -S nodejs && \
    adduser -S nodeuser -u 1001

# Fix file ownership for non-root user
RUN chown -R nodeuser:nodejs /app
USER nodeuser

# Expose port
EXPOSE 3001

# Health check (use fixed port; Render maps externally)
HEALTHCHECK --interval=30s --timeout=5s --start-period=10s --retries=3 \
  CMD wget --no-verbose --tries=1 --spider http://localhost:3001/health || exit 1

# Start server
CMD ["node", "server.js"]
