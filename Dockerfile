# Build stage
FROM node:20-alpine AS builder

WORKDIR /app

# Build arguments for Vite
ARG VITE_ODOO_URL
ARG VITE_ODOO_API_KEY

# Set as environment variables for build
ENV VITE_ODOO_URL=$VITE_ODOO_URL
ENV VITE_ODOO_API_KEY=$VITE_ODOO_API_KEY

# Copy package files
COPY package*.json ./

# Install dependencies
RUN npm ci

# Copy source
COPY . .

# Build for production
RUN npm run build

# Production stage
FROM nginx:alpine

# Copy custom nginx config
COPY nginx.conf /etc/nginx/conf.d/default.conf

# Copy built files from builder
COPY --from=builder /app/dist /usr/share/nginx/html

# Expose port
EXPOSE 80

CMD ["nginx", "-g", "daemon off;"]
