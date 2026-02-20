<docker_overview>
The generated service uses a multi-stage Docker build for minimal image size and docker-compose for easy local deployment.

See `templates/docker.md` for the Dockerfile, docker-compose.yml, and .dockerignore templates.
</docker_overview>

<key_patterns>
- **Multi-stage build**: Builder stage (`node:20-alpine`) runs `npm ci` + `npm run build`; production stage copies only `dist/` and production deps
- **ENV NODE_ENV=production**: Set at image build time in the production stage (before `npm ci --only=production`)
- **Port 3000**: Exposed in Dockerfile, mapped in docker-compose
- **Healthcheck**: Uses `wget --spider` against the Swagger endpoint (`/api`)
- **Restart policy**: `unless-stopped` for production resilience
</key_patterns>

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
