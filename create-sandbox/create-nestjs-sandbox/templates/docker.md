<dockerfile_template>
```dockerfile
# Stage 1: Build
FROM node:20-alpine AS builder

WORKDIR /app

COPY package*.json ./
RUN npm ci

COPY . .
RUN npm run build

# Stage 2: Production
FROM node:20-alpine AS production

WORKDIR /app

ENV NODE_ENV=production

COPY package*.json ./
RUN npm ci --only=production

COPY --from=builder /app/dist ./dist

EXPOSE 3000

CMD ["node", "dist/main"]
```
</dockerfile_template>

<docker_compose_template>
```yaml
version: '3.8'

services:
  sandbox-api:
    build:
      context: .
      dockerfile: Dockerfile
    ports:
      - '3000:3000'
    environment:
      - NODE_ENV=production
      - PORT=3000
    restart: unless-stopped
    healthcheck:
      test: ['CMD', 'wget', '--no-verbose', '--tries=1', '--spider', 'http://localhost:3000/api']
      interval: 30s
      timeout: 10s
      retries: 3
      start_period: 10s
```
</docker_compose_template>

<dockerignore_template>
```
node_modules
dist
.git
.gitignore
*.md
.env
.eslintrc.js
```
</dockerignore_template>
