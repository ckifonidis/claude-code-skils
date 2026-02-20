<required_reading>
**Read these reference files NOW:**
1. references/data-parsing.md
2. references/entity-model.md
3. references/sandbox-architecture.md
4. references/docker-setup.md
</required_reading>

<process>

**Step 1: Read and Analyze Input Data**

Read the provided API data (file, directory, or inline text). If a file path or directory is provided, use the Read tool to load the contents.

Identify each API call block by looking for URL patterns (lines starting with `http://` or `https://`). For each block, extract:
- The full URL
- The request JSON body (contains `header` and `payload`)
- The response JSON body (contains `payload`, `exception`, `messages`, `executionTime`)

**Step 2: Parse URL Segments and Identify Controllers**

For each API call block:
1. Strip the base URL (protocol + host + port) and environment-specific prefix (e.g., `/CBSTESTPLEX/`)
2. Split the remaining path into segments and map to `{api}/{controller}/{action}`:
   - **api** - The API group identifier
   - **controller** - The resource/entity → becomes the NestJS controller
   - **action** - The specific operation → becomes the endpoint method
3. Parse the request payload structure (field names, types, nesting)
4. Parse the response payload structure (field names, types, nesting)
5. Record the endpoint: `{ api, controller, action, url, requestPayload, responsePayload }`

**Step 2a: Handle Ambiguous URLs**

If a URL does **not** clearly fit the `{api}/{controller}/{action}` three-segment pattern (more segments, fewer segments, or unclear roles), use `AskUserQuestion` to clarify:
- Present the problematic URL and extracted segments
- Ask the user to identify which segment is the api, controller, and action
- Provide the most likely interpretations as options

Do NOT guess. Always confirm with the user when the pattern does not match.

Group endpoints by controller. Example output (entity types depend on what's discovered in the data):
```
controllers:
  {controller-a}:
    - api: {apiGroup}, action: {action1}, requestFields: [...], responseFields: [...]
  {controller-b}:
    - api: {apiGroup}, action: {action2}, requestFields: [...], responseFields: [...]
  {controller-c}:
    - api: {apiGroup}, action: {action3}, ...
    - api: {apiGroup}, action: {action4}, ...
```

**Step 3: Identify Entities and Relationships**

Read `references/entity-model.md`. Analyze all parsed endpoints to identify domain entities dynamically. Do NOT assume any specific entity types — discover them from the data:

1. **Find recurring identifiers** across request parameters and response fields:
   - Request lookup keys (e.g., `customerCode`, `cardNumber`, `accountNo`, `loanId`, `branchCode`)
   - Response record identifiers (e.g., unique IDs in search results, detail responses)

2. **Define entity types dynamically** from the recurring identifiers:
   ```
   entities:
     {EntityTypeA}:
       primaryKey: {fieldName}
       sources: [{endpoint1} response items]
       fields: [field1, field2, field3, ...]

     {EntityTypeB}:
       primaryKey: {fieldName}
       foreignKeys: [{parentKeyField} → {EntityTypeA}]
       sources: [{endpoint2}, {endpoint3} response data]
       fields: [field1, field2, field3, ...]

     {EntityTypeC}:
       primaryKey: {fieldName}
       foreignKeys: [{parentKeyField} → {EntityTypeA}]
       sources: [{endpoint4} sub-products]
       fields: [field1, field2, ...]
   ```

3. **Identify the root entity** - the entity that others reference. Use `AskUserQuestion` to confirm:
   - Present the candidate entities and their relationships
   - Ask: "Which is the root/base entity that others relate to?"

4. **Map relationships** between entities:
   - One-to-many: Parent entity → Child entities
   - Lookup keys: which request fields map to which entity primary keys

5. **Identify metadata requirements** for cross-entity queries:
   - **Parent-child relations**: Which child entity keys belong to which parent? → populate `parentChildRelations`
   - **Type grouping Maps**: Are entities grouped by type/category in aggregation responses? → populate `typeGroupings` for relevant entity types
   - **Pre-computed view data**: Do aggregation endpoints return entity data in a different format? → populate `preComputedViews`
   - See `references/entity-model.md` `<metadata_system>` for full details

6. **Classify each endpoint** by its query pattern:
   - **Search**: Filters entities by criteria, may use metadata for parent-child ownership checks
   - **Lookup**: Fetches a single entity by primary key
   - **Aggregation**: Uses metadata for cross-entity lookups and type grouping
   - **List by parent**: Lists child entities with optional date filtering
   - **Related entity lookup**: Uses related entity fields for filtering

**Step 4: Determine Output Directory**

Use the user-specified output directory, or default to `./sandbox-service/` relative to the current working directory. Create the directory structure:

```bash
mkdir -p {output_dir}/src/{common/{dto,interfaces,decorators},sandbox/dto,controllers}
```

**Step 5: Generate Project Scaffold**

Read `templates/project-scaffold.md` and generate:
- `package.json` - with NestJS dependencies, Swagger, uuid, class-validator, class-transformer
- `tsconfig.json` - standard NestJS TypeScript config
- `tsconfig.build.json` - build-specific config
- `nest-cli.json` - NestJS CLI configuration

**Step 6: Generate Common Modules**

Generate the shared components:

1. **`src/common/dto/api-header.dto.ts`** - Shared API header DTO with `@ApiProperty()` decorators, inferred from the `header` field in the request data
2. **`src/common/interfaces/sandbox-store.interface.ts`** - TypeScript interfaces for `EntityStore`, `SandboxMetadata`, `SandboxData`, and `SerializedSandboxData`. The `SandboxMetadata` interface uses three dynamic structures: `parentChildRelations`, `typeGroupings`, and `preComputedViews` (see `<metadata_system>` in entity-model.md)
3. **`src/common/interfaces/entities.interface.ts`** - TypeScript interfaces for each **dynamically identified** entity type with primary keys, foreign keys, and all merged fields. Do NOT hardcode specific entity types — generate interfaces based on what was discovered in Step 3.
4. **`src/common/decorators/sandbox-id.decorator.ts`** - Optional custom decorator for sandboxId extraction

**Step 7: Generate Sandbox Management Module**

Read `templates/sandbox-module.md` and `references/entity-model.md` (especially `<entity_validation>`). Generate:

1. **`src/sandbox/sandbox.module.ts`** - Global module exporting SandboxService
2. **`src/sandbox/sandbox.service.ts`** - Service managing the entity store with:
   - Three data maps: `primaryKeyMap`, `entitySchemas`, `uniqueFieldsMap` (populated from **dynamically identified** entities)
   - `createSandbox()` - Initialize sandbox with seed entities
   - `getSandbox()` - Return sandbox config and entity summary
   - `updateSandbox()` - Two-pass validate-then-mutate: validates all entity types first (unknown types, unknown ops, shape, uniqueness), then applies mutations
   - `deleteSandbox()` - Remove sandbox
   - `getEntities()` - Get the full entity store for a sandbox
   - `getEntityCollection()` - Get all entities of a type
   - `getEntity()` - Get a single entity by primary key
   - `findEntities()` - Find entities matching a predicate
   - `getMetadata()` - Get the metadata (parentChildRelations, typeGroupings, preComputedViews)
   - `validateEntityShape()` - Private method checking required fields and typeof types against `entitySchemas`
   - `validateUniqueFields()` - Private method checking uniqueness constraints against `uniqueFieldsMap`
   - `generateSeedData()` - Private method that returns `{ entities, metadata }` extracted from parsed API responses. Entities and metadata structures are built dynamically based on discovered entity types.
   - Import `BadRequestException`, `ConflictException` from `@nestjs/common`
3. **`src/sandbox/sandbox.controller.ts`** - REST controller with POST/GET/PUT/DELETE at `/sandboxes`
4. **`src/sandbox/dto/create-sandbox.dto.ts`** - DTO for sandbox creation
5. **`src/sandbox/dto/update-sandbox.dto.ts`** - DTO for sandbox updates. **IMPORTANT:** Do NOT use `@ValidateNested()` or `@Type()` on `entities` field — type it as `Record<string, any>` with only `@IsOptional()` and `@IsObject()`. All validation is service-level. See `<entity_validation>` in entity-model.md.

The `entitySchemas` map must be populated from the **dynamically identified** entity interfaces:
- For each entity type, list all required (non-optional) fields and their `typeof` type
- Types are: `'string'`, `'number'`, `'boolean'`, `'object'` (for nested objects/arrays)

The `uniqueFieldsMap` must include:
- Primary key fields for each entity type
- Any natural keys identified from the data

The `generateSeedData()` method must return `{ entities, metadata }`:
- **Entities**: Extract entity instances from parsed API response data, store in Maps keyed by primary key, link via foreign keys, merge fields from multiple endpoints
- **Metadata**: Generate alongside entities from the same seed data:
  - `parentChildRelations`: Map each root entity's key to a Record of child entity type → child key arrays
  - `typeGroupings`: For entity types with type/category info, map entity keys to their type data
  - `preComputedViews`: For entities appearing in different shapes in aggregation responses, store pre-computed fragments

**Step 8: Generate Controller Modules**

Read `templates/controller-module.md`. For **each controller** identified in Step 2:

1. Create the controller directory: `src/controllers/{controller-name}/dto/`

2. **Generate DTOs** for each endpoint in the controller:
   - `{action}-request.dto.ts` - Request payload DTO with `@ApiProperty()` decorators
   - For nested objects, create separate DTO classes in the same file or as separate files
   - Use `class-validator` decorators where appropriate (`@IsString()`, `@IsNumber()`, `@IsOptional()`, etc.)

3. **Generate Service** (`{controller}.service.ts`):
   - Inject `SandboxService`
   - One handler method per endpoint action
   - Each handler implements the appropriate query pattern (from Step 3):
     - **Search endpoints**: Use `sandboxService.findEntities()` with predicates; use `sandboxService.getMetadata()` and `parentChildRelations` for ownership checks
     - **Lookup endpoints**: Use `sandboxService.getEntity()` with the primary key from the request
     - **Aggregation endpoints**: Use `sandboxService.getMetadata()` for `parentChildRelations`, `typeGroupings`, and `preComputedViews`
     - **List by parent endpoints**: Use `sandboxService.findEntities()` with optional date range filtering
     - **Related entity lookup**: Check both direct and related keys
   - Include private response mapper methods using `?? defaultValue` fallbacks and conditional field inclusion
   - Compute derived fields (`total`, `listCount`, `moreData`) at response time

4. **Generate Controller** (`{controller}.controller.ts`):
   - Route prefix: `sandbox/:sandboxId/{api-path-segments}`
   - One endpoint per action (use POST to match the original API calls)
   - Swagger decorators: `@ApiTags()`, `@ApiOperation()`, `@ApiParam()`, `@ApiBody()`, `@ApiResponse()`
   - Extract `sandboxId` from route params
   - Delegate to service

5. **Generate Module** (`{controller}.module.ts`):
   - Import `SandboxModule`
   - Declare controller and service

**Step 9: Generate AppModule and main.ts**

Read `templates/main-ts.md` and generate:

1. **`src/app.module.ts`** - Import `SandboxModule` + all controller modules
2. **`src/main.ts`** - Bootstrap with Swagger configuration:
   - DocumentBuilder with title, description, version
   - SwaggerModule.setup at `/api`
   - CORS enabled
   - Listen on port from env `PORT` or default `3000`

**Step 10: Generate Docker Files**

Read `templates/docker.md` and generate:
- `Dockerfile` - Multi-stage build (builder + production)
- `docker-compose.yml` - Service definition with port mapping, healthcheck
- `.dockerignore` - Exclude node_modules, dist, .git

**Step 11: Install Dependencies and Verify**

Run the following commands in the output directory:

```bash
cd {output_dir}
npm install
npm run build
```

If the build fails, read the error output and fix the generated code. Common issues:
- Missing imports (ensure all DTOs and modules are properly imported)
- Circular dependencies (ensure modules use `forwardRef()` if needed)
- TypeScript type errors (ensure DTO types match the inferred structures)

Iterate until the build succeeds.

**Step 12: Report to User**

Present the generated service summary:
- **Entity model**: List of dynamically identified entities, their primary keys, relationships, and which endpoints map to them
- List of identified controllers and their endpoints (with query pattern classification)
- Project directory structure
- How to run: `npm run start:dev` or `docker-compose up --build`
- Swagger URL: `http://localhost:3000/api`
- Example curl commands:
  - Create sandbox: `curl -X POST http://localhost:3000/sandboxes`
  - Create sandbox (custom ID): `curl -X POST http://localhost:3000/sandboxes -H "Content-Type: application/json" -d '{"sandboxId": "my-sandbox-1"}'`
  - Call controller endpoint: `curl -X POST http://localhost:3000/sandbox/{sandboxId}/{controller}/{action}`
  - Add entities: `curl -X PUT http://localhost:3000/sandboxes/{sandboxId} -H "Content-Type: application/json" -d '{"entities": {"{entityType}": {"add": [...]}}}'`

</process>

<success_criteria>
Before reporting completion, verify:
- [ ] All API call blocks parsed from input data
- [ ] URL segments mapped to `{api}/{controller}/{action}` (ambiguities clarified with user)
- [ ] Controllers and endpoints correctly identified and grouped
- [ ] **Domain entities dynamically identified** with primary keys and relationships (no hardcoded entity types)
- [ ] **Root entity confirmed** with user via AskUserQuestion
- [ ] **Each endpoint classified** by query pattern (search, lookup, aggregation, list by parent)
- [ ] Project scaffold files generated (package.json, tsconfig, etc.)
- [ ] **Entity interfaces dynamically generated** in `src/common/interfaces/entities.interface.ts`
- [ ] Sandbox management module generated with entity CRUD operations
- [ ] **Entity validation**: `entitySchemas` populated from discovered entity interfaces, `uniqueFieldsMap` populated with discovered unique fields, `primaryKeyMap` populated with discovered primary key mappings
- [ ] **Validation methods**: `validateEntityShape()` and `validateUniqueFields()` implemented
- [ ] **Two-pass updateSandbox()**: Pass 1 validates all operations, Pass 2 applies mutations
- [ ] **UpdateSandboxDto**: `entities` typed as `Record<string, any>` (NOT `Record<string, EntityOperationsDto>`), no `@ValidateNested`/`@Type`
- [ ] **TypeScript safety**: `...(updates as object)` in update merge, `operations.update as Record<string, any>` in Object.entries()
- [ ] **ValidationPipe**: `forbidNonWhitelisted: true` in main.ts
- [ ] Each controller has its own module with controller, service, and DTOs
- [ ] **Controller services implement entity queries** (not static response returns)
- [ ] **Response mappers** convert entity data to exact API response format
- [ ] DTOs accurately reflect the provided API data structures
- [ ] **Seed data** in SandboxService: both entities AND metadata extracted from sample responses
- [ ] **Metadata dynamically built**: `parentChildRelations` (root key → child type → child keys), `typeGroupings` (entity type → entity key → type info), `preComputedViews` (view name → entity key → pre-computed data)
- [ ] **Metadata excluded from API responses**: `serializeSandbox()` returns only `sandboxId`, `createdAt`, `entities`
- [ ] **`getMetadata()` method** on SandboxService for controller services to access metadata
- [ ] **Aggregation endpoints use metadata** structures for cross-entity lookups (not filter predicates on all entities)
- [ ] **Response mappers** use `?? defaultValue` fallbacks, conditional field inclusion, and type conversions where needed
- [ ] **Date range filtering** implemented for list/transaction endpoints
- [ ] main.ts includes Swagger setup
- [ ] Docker files generated
- [ ] `npm run build` succeeds
- [ ] User receives summary with entity model, run instructions, and example commands
</success_criteria>
