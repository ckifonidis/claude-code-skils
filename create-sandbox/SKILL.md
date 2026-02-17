---
name: create-sandbox
description: Generates containerized NestJS sandbox services from API request/response samples. Creates in-memory endpoints organized by controller (cards, customer, position) with sandbox lifecycle management. Use when building mock API services or creating sandbox environments from sample data.
---

<objective>
Generates production-ready NestJS sandbox services from API request/response samples. Creates containerized services with in-memory storage, controller-based architecture, and Swagger documentation. Enables rapid API mocking for testing, demos, and development without backend dependencies.
</objective>

<quick_start>
1. Provide API request/response data (file path, directory, or inline text)
2. Specify output directory (defaults to `./sandbox-service/`)
3. Skill parses URLs into `{api}/{controller}/{action}` segments, generates NestJS modules, DTOs, and Docker files
4. If URL segments are ambiguous, the skill asks you to clarify which segment is which
5. Runs `npm install && npm run build` to verify
6. Provides run commands and Swagger URL at `/api`
</quick_start>

<essential_principles>

**Sandbox Isolation** - Each sandbox (by sandboxId) maintains isolated in-memory data. Sandboxes do not share state.

**Data Fidelity** - Preserve exact field names, types, and nesting from provided API responses. DTOs are inferred from response JSON structures.

**Controller-Based Organization** - URLs are parsed into `{api}/{controller}/{action}` segments. Each unique controller value gets its own NestJS module (controller, service, DTOs). When URL segments are ambiguous, ask the user for clarification using AskUserQuestion.

</essential_principles>

<sandbox_management_api>
Every generated service includes a sandbox controller at `/sandboxes`:
- `POST /sandboxes` - Create sandbox with seed data. Accepts optional `sandboxId` in the request body; if provided, uses it as the sandbox identifier, otherwise generates a UUID.
- `GET /sandboxes/:sandboxId` - Get sandbox config and data models
- `PUT /sandboxes/:sandboxId` - Update sandbox endpoints or data
- `DELETE /sandboxes/:sandboxId` - Delete sandbox

Controller endpoints live under `/sandbox/:sandboxId/{controller}/{action}`.
</sandbox_management_api>

<input_formats>
Accepted API data formats:
- **File path** - Text file with URL + request + response blocks
- **Directory path** - Directory of API data files
- **Inline data** - Raw API data pasted in conversation

Output directory defaults to `./sandbox-service/` if not specified.
</input_formats>

<workflow>
Follow `workflows/generate-service.md` to parse API data and generate the complete NestJS sandbox service.
</workflow>

<references>
- references/data-parsing.md - Parse API URLs into `{api}/{controller}/{action}`, extract DTOs, handle ambiguity
- references/sandbox-architecture.md - NestJS module structure, in-memory storage patterns
- references/docker-setup.md - Dockerfile, docker-compose patterns
</references>

<templates>
- templates/project-scaffold.md - package.json, tsconfig.json, nest-cli.json
- templates/main-ts.md - main.ts with Swagger setup, app.module.ts
- templates/sandbox-module.md - Sandbox management module (controller, service, DTOs)
- templates/controller-module.md - Controller-specific module pattern (controller, service, DTOs)
- templates/docker.md - Dockerfile + docker-compose.yml
</templates>

<success_criteria>
The skill is successful when:
- URLs are correctly parsed into `{api}/{controller}/{action}` segments (ambiguities resolved with user)
- Generated service correctly implements all controllers and endpoints from input data
- Sandbox CRUD operations are functional at `/sandboxes` endpoints
- Controller endpoints return sample data when called with sandboxId
- DTOs accurately match provided API structures with Swagger decorators
- Docker containerization is ready for deployment
- Swagger documentation is accessible at `/api`
</success_criteria>
