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
   - **api** - The API group identifier (e.g., `apiCra`, `cosmosCraApi`, `apiOtherServices`)
   - **controller** - The resource/entity (e.g., `customer`, `position`, `cards`) → becomes the NestJS controller
   - **action** - The specific operation (e.g., `SimpleSearch`, `fetchCreditCardFullData`) → becomes the endpoint method
3. Parse the request payload structure (field names, types, nesting)
4. Parse the response payload structure (field names, types, nesting)
5. Record the endpoint: `{ api, controller, action, url, requestPayload, responsePayload }`

**Step 2a: Handle Ambiguous URLs**

If a URL does **not** clearly fit the `{api}/{controller}/{action}` three-segment pattern (more segments, fewer segments, or unclear roles), use `AskUserQuestion` to clarify:
- Present the problematic URL and extracted segments
- Ask the user to identify which segment is the api, controller, and action
- Provide the most likely interpretations as options

Do NOT guess. Always confirm with the user when the pattern does not match.

Group endpoints by controller. Example output:
```
controllers:
  customer:
    - api: apiCra, action: simpleSearch, requestFields: [taxNo, lifeCycleStatus, ...], responseFields: [items[...], moreData, ...]
  position:
    - api: cosmosCraApi, action: getCustomerProducts, requestFields: [customerCode, doNotFetchCards], responseFields: [productGroups[...], ...]
  cards:
    - api: apiOtherServices, action: fetchCreditCardFullData, ...
    - api: apiOtherServices, action: fetchLoggingTransactions, ...
    - api: apiOtherServices, action: fetchDetails, ...
    - api: apiOtherServices, action: fetchTransactions, ...
```

**Step 3: Identify Entities and Relationships**

Read `references/entity-model.md`. Analyze all parsed endpoints to identify domain entities:

1. **Find recurring identifiers** across request parameters and response fields:
   - Request lookup keys (e.g., `customerCode`, `cardNumber`, `taxNo`)
   - Response record identifiers (e.g., `customerCode` in search results, `cardNumber` in card details)

2. **Define entity types** from the recurring identifiers:
   ```
   entities:
     Customer:
       primaryKey: customerCode
       sources: [customer/simpleSearch response items]
       fields: [name, taxNo, branch, type, activityStatus, ...]

     Card:
       primaryKey: cardNumber
       foreignKeys: [customerCode → Customer]
       sources: [cards/fetchCreditCardFullData, cards/fetchDetails, position/getCustomerProducts subProducts]
       fields: [cardStatus, productName, limits, security, expirationDate, ...]

     Account:
       primaryKey: account
       foreignKeys: [customerCode → Customer]
       sources: [position/getCustomerProducts subProducts]
       fields: [description, currency, amount, branch, ...]
   ```

3. **Identify the root entity** - the entity that others reference. Use `AskUserQuestion` to confirm:
   - Present the candidate entities and their relationships
   - Ask: "Which is the root/base entity that others relate to?"
   - Example: "Customer appears to be the root entity - Cards and Accounts belong to a Customer. Is this correct?"

4. **Map relationships** between entities:
   - One-to-many: Customer → Cards, Customer → Accounts
   - Lookup keys: which request fields map to which entity primary keys

5. **Classify each endpoint** by its query pattern:
   - **Search**: Filters entities by criteria (e.g., `customer/simpleSearch` filters customers by `taxNo`)
   - **Lookup**: Fetches a single entity by primary key (e.g., `cards/fetchCreditCardFullData` by `cardNumber`)
   - **Aggregation**: Combines multiple entity types (e.g., `position/getCustomerProducts` joins customer's accounts + cards)
   - **List by parent**: Lists child entities of a parent (e.g., `cards/fetchTransactions` lists transactions for a card)

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
2. **`src/common/interfaces/sandbox-store.interface.ts`** - TypeScript interfaces for `SandboxData` and `EntityStore`
3. **`src/common/interfaces/entities.interface.ts`** - TypeScript interfaces for each identified entity type (`CustomerEntity`, `CardEntity`, `AccountEntity`, etc.) with primary keys, foreign keys, and all merged fields
4. **`src/common/decorators/sandbox-id.decorator.ts`** - Optional custom decorator for sandboxId extraction

**Step 7: Generate Sandbox Management Module**

Read `templates/sandbox-module.md` and `references/entity-model.md` (especially `<entity_validation>`). Generate:

1. **`src/sandbox/sandbox.module.ts`** - Global module exporting SandboxService
2. **`src/sandbox/sandbox.service.ts`** - Service managing the entity store with:
   - Three data maps: `primaryKeyMap`, `entitySchemas`, `uniqueFieldsMap` (populated from identified entities)
   - `createSandbox()` - Initialize sandbox with seed entities
   - `getSandbox()` - Return sandbox config and entity summary
   - `updateSandbox()` - Two-pass validate-then-mutate: validates all entity types first (unknown types, unknown ops, shape, uniqueness), then applies mutations
   - `deleteSandbox()` - Remove sandbox
   - `getEntities()` - Get the full entity store for a sandbox
   - `getEntityCollection()` - Get all entities of a type
   - `getEntity()` - Get a single entity by primary key
   - `findEntities()` - Find entities matching a predicate
   - `validateEntityShape()` - Private method checking required fields and typeof types against `entitySchemas`
   - `validateUniqueFields()` - Private method checking uniqueness constraints against `uniqueFieldsMap`
   - `generateSeedEntities()` - Private method that extracts entity instances from parsed API responses
   - Import `BadRequestException`, `ConflictException` from `@nestjs/common`
3. **`src/sandbox/sandbox.controller.ts`** - REST controller with POST/GET/PUT/DELETE at `/sandboxes`
4. **`src/sandbox/dto/create-sandbox.dto.ts`** - DTO for sandbox creation
5. **`src/sandbox/dto/update-sandbox.dto.ts`** - DTO for sandbox updates. **IMPORTANT:** Do NOT use `@ValidateNested()` or `@Type()` on `entities` field — type it as `Record<string, any>` with only `@IsOptional()` and `@IsObject()`. All validation is service-level. See `<entity_validation>` in entity-model.md.

The `entitySchemas` map must be populated from the entity interfaces:
- For each entity type, list all required (non-optional) fields and their `typeof` type
- Types are: `'string'`, `'number'`, `'boolean'`, `'object'` (for nested objects/arrays)

The `uniqueFieldsMap` must include:
- Primary key fields for each entity type
- Any natural keys (e.g., `taxNo` for customers)

The `generateSeedEntities()` method must:
- Extract entity instances from the parsed API response data
- Store each entity in its Map keyed by primary key
- Link entities via foreign keys (e.g., set `customerCode` on each card entity)
- Merge fields from multiple endpoints when the same entity appears in different responses

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
     - **Search endpoints**: Use `sandboxService.findEntities()` with predicates based on request parameters
     - **Lookup endpoints**: Use `sandboxService.getEntity()` with the primary key from the request
     - **Aggregation endpoints**: Use `sandboxService.findEntities()` across multiple entity types and combine results
     - **List by parent endpoints**: Use `sandboxService.findEntities()` filtering by the parent's foreign key
   - Include private response mapper methods that convert entity fields to the exact API response format
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
- **Entity model**: List of identified entities, their primary keys, relationships, and which endpoints map to them
- List of identified controllers and their endpoints (with query pattern classification)
- Project directory structure
- How to run: `npm run start:dev` or `docker-compose up --build`
- Swagger URL: `http://localhost:3000/api`
- Example curl commands:
  - Create sandbox: `curl -X POST http://localhost:3000/sandboxes`
  - Create sandbox (custom ID): `curl -X POST http://localhost:3000/sandboxes -H "Content-Type: application/json" -d '{"sandboxId": "my-sandbox-1"}'`
  - Call controller endpoint: `curl -X POST http://localhost:3000/sandbox/{sandboxId}/{controller}/{action}`
  - Add entities: `curl -X PUT http://localhost:3000/sandboxes/{sandboxId} -H "Content-Type: application/json" -d '{"entities": {"customers": {"add": [...]}}}'`

</process>

<success_criteria>
Before reporting completion, verify:
- [ ] All API call blocks parsed from input data
- [ ] URL segments mapped to `{api}/{controller}/{action}` (ambiguities clarified with user)
- [ ] Controllers and endpoints correctly identified and grouped
- [ ] **Domain entities identified** with primary keys and relationships
- [ ] **Root entity confirmed** with user via AskUserQuestion
- [ ] **Each endpoint classified** by query pattern (search, lookup, aggregation, list by parent)
- [ ] Project scaffold files generated (package.json, tsconfig, etc.)
- [ ] **Entity interfaces generated** in `src/common/interfaces/entities.interface.ts`
- [ ] Sandbox management module generated with entity CRUD operations
- [ ] **Entity validation**: `entitySchemas` populated from entity interfaces, `uniqueFieldsMap` populated with unique fields, `primaryKeyMap` populated with primary key mappings
- [ ] **Validation methods**: `validateEntityShape()` and `validateUniqueFields()` implemented
- [ ] **Two-pass updateSandbox()**: Pass 1 validates all operations, Pass 2 applies mutations
- [ ] **UpdateSandboxDto**: `entities` typed as `Record<string, any>` (NOT `Record<string, EntityOperationsDto>`), no `@ValidateNested`/`@Type`
- [ ] **TypeScript safety**: `...(updates as object)` in update merge, `operations.update as Record<string, any>` in Object.entries()
- [ ] **ValidationPipe**: `forbidNonWhitelisted: true` in main.ts
- [ ] Each controller has its own module with controller, service, and DTOs
- [ ] **Controller services implement entity queries** (not static response returns)
- [ ] **Response mappers** convert entity data to exact API response format
- [ ] DTOs accurately reflect the provided API data structures
- [ ] **Seed entities** in SandboxService extracted from sample responses with correct relationships
- [ ] main.ts includes Swagger setup
- [ ] Docker files generated
- [ ] `npm run build` succeeds
- [ ] User receives summary with entity model, run instructions, and example commands
</success_criteria>
