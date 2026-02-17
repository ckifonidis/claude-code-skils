<docker_overview>
The generated service uses a multi-stage Docker build for minimal image size and docker-compose for easy local deployment.
</docker_overview>

<dockerfile_pattern>
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

COPY package*.json ./
RUN npm ci --only=production

COPY --from=builder /app/dist ./dist

EXPOSE 3000

CMD ["node", "dist/main"]
```
</dockerfile_pattern>

<docker_compose_pattern>
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
</docker_compose_pattern>

<dockerignore_pattern>
```
node_modules
dist
.git
.gitignore
*.md
.env
.eslintrc.js
```
</dockerignore_pattern>

<build_and_run>
After generation, verify the service:

```bash
# Local development
npm install
npm run build
npm run start

# Docker
docker-compose up --build

# Verify
curl http://localhost:3000/api          # Swagger UI
curl -X POST http://localhost:3000/sandboxes  # Create sandbox
```
</build_and_run>
