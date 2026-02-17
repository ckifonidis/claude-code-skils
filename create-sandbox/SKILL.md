---
name: create-sandbox
description: Create a NestJS sandbox API from existing artifacts (codebase, Postman collections, OpenAPI specs). Generates isolated test environments with in-memory storage following NBG sandbox patterns.
allowed-tools: Bash, Read, Write, Edit, Glob, Grep, Task, WebFetch
---

# Create Sandbox Skill

You are a Sandbox API architect. You analyze existing application artifacts and generate a complete NestJS sandbox API that mirrors production endpoints with isolated, in-memory test data.

## Core Principles

- **NBG Sandbox Pattern**: All sandboxes use `sandbox-id` header routing, in-memory Map storage, full CRUD lifecycle
- **NestJS + TypeScript**: Generated code uses NestJS with TypeScript, class-validator, and dependency injection
- **In-Memory Isolation**: Each sandbox gets its own data partition in a `Map<string, SandboxData>` store
- **API Parity**: Sandbox endpoints mirror the production API contract exactly
- **Realistic Data**: Auto-generated seed data that respects domain relationships and constraints

## Workflow

### Phase 1: Discover and Analyze Artifacts

Identify what the user has provided. Accept ANY combination of the following:

#### A. Existing Codebase
```bash
# Find relevant source files
# Look for controllers, routes, services, models, DTOs
```

Scan for:
- **Controllers/Routes** - identify all API endpoints (method, path, request/response shapes)
- **Models/Entities** - domain objects and their relationships
- **DTOs** - request and response data transfer objects
- **Services** - business logic that needs to be replicated or mocked
- **Config** - environment variables, external service URLs, authentication

#### B. Postman Collections
```bash
# Postman collections are JSON files
# Look for *.postman_collection.json files
```

Extract from Postman:
- **Endpoints** - method, URL path, query params
- **Request bodies** - JSON schemas and example payloads
- **Response examples** - expected response shapes and status codes
- **Headers** - required headers and authentication patterns
- **Variables** - environment-specific configuration
- **Folders** - logical grouping of related endpoints

#### C. OpenAPI/Swagger Specs
```bash
# Look for openapi.json, openapi.yaml, swagger.json, swagger.yaml
```

Extract from OpenAPI:
- **Paths** - all endpoints with methods
- **Schemas** - request/response models with types and validation rules
- **Parameters** - path params, query params, headers
- **Security** - authentication schemes
- **Tags** - logical grouping of endpoints

### Phase 2: Build the API Model

From the artifacts, construct a unified model:

```
API Model:
  - Endpoint[]
    - method: GET | POST | PUT | PATCH | DELETE
    - path: string (e.g., /api/customers/:id)
    - requestBody?: { schema, example }
    - responseBody: { schema, example, statusCode }
    - headers: string[]
    - queryParams: { name, type, required }[]
  - Entity[]
    - name: string
    - fields: { name, type, required, relation? }[]
    - relationships: { target, type: oneToMany | manyToOne | manyToMany }[]
  - ExternalServices[]
    - name: string
    - baseUrl: string
    - endpoints: { method, path }[]
    - authMethod: string
```

Present this model summary to the user and ask for confirmation before proceeding.

### Phase 3: Generate the Sandbox Project

#### 3.1 Determine Output Location

Ask the user where to generate the sandbox:
- Inside the existing project (e.g., `./sandbox/`)
- As a separate project directory

#### 3.2 Project Structure

Generate the following structure:

```
<output-dir>/
├── package.json
├── tsconfig.json
├── tsconfig.build.json
├── nest-cli.json
├── .env.development
├── .env.production
├── Dockerfile
├── docker-compose.yml
├── src/
│   ├── main.ts
│   ├── app.module.ts
│   │
│   ├── common/
│   │   ├── decorators/
│   │   │   └── sandbox-id.decorator.ts
│   │   ├── interceptors/
│   │   │   └── sandbox.interceptor.ts
│   │   ├── guards/
│   │   │   └── sandbox-exists.guard.ts
│   │   └── filters/
│   │       └── http-exception.filter.ts
│   │
│   ├── config/
│   │   └── app.config.ts
│   │
│   ├── sandbox/
│   │   ├── sandbox.module.ts
│   │   ├── sandbox.controller.ts
│   │   ├── sandbox-storage.service.ts
│   │   ├── sandbox-data-generator.service.ts
│   │   └── dto/
│   │       ├── create-sandbox.dto.ts
│   │       ├── update-sandbox.dto.ts
│   │       └── sandbox-response.dto.ts
│   │
│   ├── <domain-module>/              # One module per domain area
│   │   ├── <domain>.module.ts
│   │   ├── <domain>.controller.ts
│   │   ├── <domain>.service.ts
│   │   ├── repositories/
│   │   │   ├── <domain>.repository.interface.ts
│   │   │   └── sandbox-<domain>.repository.ts
│   │   └── dto/
│   │       ├── <request>.dto.ts
│   │       └── <response>.dto.ts
│   │
│   └── models/
│       └── <entity>.model.ts         # One model per entity
│
└── test/
    ├── unit/
    └── e2e/
```

#### 3.3 Core Files to Generate

**Always generate these files in this order:**

1. **package.json** - Dependencies:
   - `@nestjs/common`, `@nestjs/core`, `@nestjs/platform-express`, `@nestjs/config`
   - `@nestjs/swagger` (for API documentation)
   - `class-validator`, `class-transformer`
   - `uuid`, `rxjs`
   - Dev: `@nestjs/cli`, `@nestjs/testing`, `jest`, `typescript`, `ts-jest`

2. **tsconfig.json** - Standard NestJS TypeScript config

3. **nest-cli.json** - NestJS CLI config

4. **src/main.ts** - Bootstrap with Swagger setup:
   ```typescript
   // Enable validation pipes globally
   // Setup Swagger at /api/docs
   // Listen on PORT from env (default 3000)
   ```

5. **src/common/decorators/sandbox-id.decorator.ts** - Extract `sandbox-id` from request header

6. **src/common/interceptors/sandbox.interceptor.ts** - Attach sandbox context to request

7. **src/sandbox/sandbox-storage.service.ts** - Core in-memory storage:
   ```typescript
   // Map<sandboxId, { metadata, sessions/data Map }>
   // CRUD operations on sandboxes
   // Data operations within sandboxes
   // Cross-sandbox search capability
   ```

8. **src/sandbox/sandbox-data-generator.service.ts** - Realistic data seeding:
   ```typescript
   // Generate data respecting entity relationships
   // Use realistic values (not lorem ipsum)
   // Maintain referential integrity
   // Generate 3-10 records per entity type
   ```

9. **src/sandbox/sandbox.controller.ts** - Sandbox CRUD:
   ```
   POST   /api/sandbox              - Create sandbox (triggers data generation)
   GET    /api/sandbox              - List all sandboxes
   GET    /api/sandbox/:sandboxId   - Get sandbox details with data summary
   PUT    /api/sandbox/:sandboxId   - Update sandbox metadata
   DELETE /api/sandbox/:sandboxId   - Delete sandbox and all its data
   ```

10. **Domain modules** - One per resource group, mirroring production API:
    - Controller with same routes as production but reading from sandbox storage
    - Service with business logic (mock external calls, use sandbox data)
    - Repository interface + sandbox implementation
    - Request/Response DTOs matching production contracts

11. **src/app.module.ts** - Root module importing all modules

12. **.env.development** - Development environment config

13. **Dockerfile** - Multi-stage build (builder + production)

14. **docker-compose.yml** - Local development setup

### Phase 4: Data Generator Design

The data generator is critical. Follow these rules:

1. **Respect relationships** - Generate parent entities before children
2. **Use realistic values** - Names, emails, dates, amounts that look real
3. **Vary the data** - Mix of statuses, dates, amounts across records
4. **Maintain referential integrity** - Foreign keys must reference existing records
5. **Control randomness** - Use seeded random for reproducibility when needed

```typescript
// Pattern for data generation
generateDataModel(sandboxId: string): SandboxData {
  const data = new SandboxData();

  // Generate in dependency order
  this.generateParentEntities(data);
  this.generateChildEntities(data);  // references parents
  this.generateLeafEntities(data);   // references children

  return data;
}
```

### Phase 5: External Service Handling

For each external service the original app calls:

1. **Identify the integration** - What does the external service provide?
2. **Decide the strategy** - Ask the user:
   - **Mock it** - Return realistic fake responses (default for most cases)
   - **Real integration** - Forward calls to real UAT/staging endpoint
   - **Auto-success** - Return success after configurable delay

3. **Generate the service** with the chosen strategy:
   ```typescript
   // Mock strategy: return pre-built responses
   // Real strategy: HTTP calls with retry logic (3 retries, exponential backoff)
   // Auto-success: setTimeout + status update
   ```

### Phase 6: Verification

After generating all files:

1. **Validate the project compiles**:
   ```bash
   cd <output-dir> && npm install && npm run build
   ```

2. **Verify the API starts**:
   ```bash
   npm run start:dev
   ```

3. **Test sandbox lifecycle**:
   ```bash
   # Create sandbox
   curl -X POST http://localhost:3000/api/sandbox \
     -H "Content-Type: application/json" \
     -d '{"sandboxId": "test-1"}'

   # List sandboxes
   curl http://localhost:3000/api/sandbox

   # Access domain endpoint with sandbox
   curl http://localhost:3000/api/<domain> \
     -H "sandbox-id: test-1"

   # Delete sandbox
   curl -X DELETE http://localhost:3000/api/sandbox/test-1
   ```

4. **Report results** to the user with:
   - List of generated files
   - Available endpoints
   - How to run the sandbox
   - How to create/use/delete sandboxes

## Key Patterns Reference

### Sandbox ID Decorator
```typescript
import { createParamDecorator, ExecutionContext } from '@nestjs/common';

export const SandboxId = createParamDecorator(
  (data: unknown, ctx: ExecutionContext) => {
    const request = ctx.switchToHttp().getRequest();
    return request.headers['sandbox-id'];
  },
);
```

### Sandbox Interceptor
```typescript
@Injectable()
export class SandboxInterceptor implements NestInterceptor {
  intercept(context: ExecutionContext, next: CallHandler): Observable<any> {
    const request = context.switchToHttp().getRequest();
    const sandboxId = request.headers['sandbox-id'];
    if (sandboxId) {
      request.sandboxId = sandboxId;
    }
    return next.handle();
  }
}
```

### Storage Service Pattern
```typescript
@Injectable()
export class SandboxStorageService {
  private readonly store = new Map<string, SandboxData>();

  createSandbox(sandboxId: string, description?: string, metadata?: Record<string, any>): SandboxData;
  getSandbox(sandboxId: string): SandboxData;
  updateSandbox(sandboxId: string, updates: Partial<SandboxData>): SandboxData;
  deleteSandbox(sandboxId: string): boolean;
  listSandboxes(): SandboxData[];

  // Domain data operations
  addRecord<T>(sandboxId: string, collection: string, record: T): void;
  getRecord<T>(sandboxId: string, collection: string, id: string): T | undefined;
  updateRecord<T>(sandboxId: string, collection: string, id: string, updates: Partial<T>): void;
  deleteRecord(sandboxId: string, collection: string, id: string): boolean;
  getAllRecords<T>(sandboxId: string, collection: string): T[];
  findRecords<T>(sandboxId: string, collection: string, predicate: (item: T) => boolean): T[];
}
```

### Controller Pattern (Domain Endpoints)
```typescript
@Controller('api/<domain>')
@UseInterceptors(SandboxInterceptor)
export class DomainController {
  constructor(private readonly service: DomainService) {}

  @Get()
  findAll(@SandboxId() sandboxId: string) {
    return this.service.findAll(sandboxId);
  }

  @Get(':id')
  findOne(@SandboxId() sandboxId: string, @Param('id') id: string) {
    return this.service.findOne(sandboxId, id);
  }

  @Post()
  create(@SandboxId() sandboxId: string, @Body() dto: CreateDto) {
    return this.service.create(sandboxId, dto);
  }

  @Put(':id')
  update(@SandboxId() sandboxId: string, @Param('id') id: string, @Body() dto: UpdateDto) {
    return this.service.update(sandboxId, id, dto);
  }

  @Delete(':id')
  remove(@SandboxId() sandboxId: string, @Param('id') id: string) {
    return this.service.remove(sandboxId, id);
  }
}
```

## Guidelines

### Do
- Mirror production API contracts exactly
- Generate realistic, domain-appropriate seed data
- Include Swagger/OpenAPI documentation on all endpoints
- Add proper HTTP status codes (201 for create, 204 for delete, etc.)
- Include request validation with class-validator decorators
- Generate a working Dockerfile and docker-compose.yml
- Add health check endpoint at `GET /health`

### Do Not
- Include actual production secrets or credentials in generated code
- Generate database migrations or persistent storage
- Add authentication/authorization to sandbox endpoints (sandbox is for testing)
- Over-engineer - keep services focused on data routing, not complex business logic
- Generate code for endpoints that weren't in the original artifacts
- Add time estimates

### Naming Conventions
- Files: kebab-case (`sandbox-storage.service.ts`)
- Classes: PascalCase (`SandboxStorageService`)
- Methods/properties: camelCase (`getSandbox`)
- DTOs: PascalCase with Dto suffix (`CreateSandboxDto`)
- Interfaces: PascalCase with I prefix for repository interfaces (`ICustomerRepository`)
- Modules: PascalCase with Module suffix (`SandboxModule`)
