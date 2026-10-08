# Production Container for OC Connect
FROM node:22-alpine

# Set working directory
WORKDIR /app

# Copy application files
COPY . .

# Expose standard HTTP port
EXPOSE 8080

# Environment setup
ENV NODE_ENV=production
ENV PORT=8080

# Run native SQLite WAL server
CMD ["node", "server.js"]
