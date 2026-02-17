<required_reading>
**Read these reference files NOW:**
1. references/data-parsing.md
2. references/sandbox-architecture.md
3. references/docker-setup.md
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

**Step 3: Determine Output Directory**

Use the user-specified output directory, or default to `./sandbox-service/` relative to the current working directory. Create the directory structure:

```bash
mkdir -p {output_dir}/src/{common/{dto,interfaces,decorators},sandbox/dto,controllers}
```

**Step 4: Generate Project Scaffold**

Read `templates/project-scaffold.md` and generate:
- `package.json` - with NestJS dependencies, Swagger, uuid, class-validator, class-transformer
- `tsconfig.json` - standard NestJS TypeScript config
- `tsconfig.build.json` - build-specific config
- `nest-cli.json` - NestJS CLI configuration

**Step 5: Generate Common Modules**

Generate the shared components:

1. **`src/common/dto/api-header.dto.ts`** - Shared API header DTO with `@ApiProperty()` decorators, inferred from the `header` field in the request data
2. **`src/common/interfaces/sandbox-store.interface.ts`** - TypeScript interfaces for `SandboxData`, `ControllerData`, `EndpointData`
3. **`src/common/decorators/sandbox-id.decorator.ts`** - Optional custom decorator for sandboxId extraction

**Step 6: Generate Sandbox Management Module**

Read `templates/sandbox-module.md` and generate:

1. **`src/sandbox/sandbox.module.ts`** - Global module exporting SandboxService
2. **`src/sandbox/sandbox.service.ts`** - Service managing the in-memory sandbox store with:
   - `createSandbox()` - Initialize sandbox with seed data from ALL controllers
   - `getSandbox()` - Return sandbox config and data summary
   - `updateSandbox()` - Modify sandbox data or endpoint configs
   - `deleteSandbox()` - Remove sandbox
   - `getControllerData()` - Get data for a specific controller within a sandbox
   - `generateSeedData()` - Private method that creates initial data from parsed API responses
3. **`src/sandbox/sandbox.controller.ts`** - REST controller with POST/GET/PUT/DELETE at `/sandboxes`
4. **`src/sandbox/dto/create-sandbox.dto.ts`** - DTO for sandbox creation
5. **`src/sandbox/dto/update-sandbox.dto.ts`** - DTO for sandbox updates
6. **`src/sandbox/dto/sandbox-response.dto.ts`** - DTO for sandbox responses

The `generateSeedData()` method must embed the actual sample response data from the parsed API calls. This means the seed data is hardcoded from the provided samples.

**Step 7: Generate Controller Modules**

Read `templates/controller-module.md`. For **each controller** identified in Step 2:

1. Create the controller directory: `src/controllers/{controller-name}/dto/`

2. **Generate DTOs** for each endpoint in the controller:
   - `{action}-request.dto.ts` - Request payload DTO with `@ApiProperty()` decorators
   - `{action}-response.dto.ts` - Response payload DTO with `@ApiProperty()` decorators
   - For nested objects, create separate DTO classes in the same file or as separate files
   - Use `class-validator` decorators where appropriate (`@IsString()`, `@IsNumber()`, `@IsOptional()`, etc.)

3. **Generate Service** (`{controller}.service.ts`):
   - Inject `SandboxService`
   - One handler method per endpoint action
   - Each handler retrieves data from `sandboxService.getControllerData(sandboxId, controller)`
   - Returns the seed response matching the endpoint

4. **Generate Controller** (`{controller}.controller.ts`):
   - Route prefix: `sandbox/:sandboxId/{api-path-segments}`
   - One endpoint per action (use POST to match the original API calls)
   - Swagger decorators: `@ApiTags()`, `@ApiOperation()`, `@ApiParam()`, `@ApiBody()`, `@ApiResponse()`
   - Extract `sandboxId` from route params
   - Delegate to service

5. **Generate Module** (`{controller}.module.ts`):
   - Import `SandboxModule`
   - Declare controller and service

**Step 8: Generate AppModule and main.ts**

Read `templates/main-ts.md` and generate:

1. **`src/app.module.ts`** - Import `SandboxModule` + all controller modules
2. **`src/main.ts`** - Bootstrap with Swagger configuration:
   - DocumentBuilder with title, description, version
   - SwaggerModule.setup at `/api`
   - CORS enabled
   - Listen on port from env `PORT` or default `3000`

**Step 9: Generate Docker Files**

Read `templates/docker.md` and generate:
- `Dockerfile` - Multi-stage build (builder + production)
- `docker-compose.yml` - Service definition with port mapping, healthcheck
- `.dockerignore` - Exclude node_modules, dist, .git

**Step 10: Install Dependencies and Verify**

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

**Step 11: Report to User**

Present the generated service summary:
- List of identified controllers and their endpoints
- Project directory structure
- How to run: `npm run start:dev` or `docker-compose up --build`
- Swagger URL: `http://localhost:3000/api`
- Example curl commands:
  - Create sandbox (auto-generated ID): `curl -X POST http://localhost:3000/sandboxes`
  - Create sandbox (custom ID): `curl -X POST http://localhost:3000/sandboxes -H "Content-Type: application/json" -d '{"sandboxId": "my-sandbox-1"}'`
  - Call controller endpoint: `curl -X POST http://localhost:3000/sandbox/{sandboxId}/{controller}/{action}`

</process>

<verification_checklist>
Before reporting completion, verify:
- [ ] All API call blocks parsed from input data
- [ ] URL segments mapped to `{api}/{controller}/{action}` (ambiguities clarified with user)
- [ ] Controllers and endpoints correctly identified and grouped
- [ ] Project scaffold files generated (package.json, tsconfig, etc.)
- [ ] Sandbox management module generated with CRUD operations
- [ ] Each controller has its own module with controller, service, and DTOs
- [ ] DTOs accurately reflect the provided API data structures
- [ ] Seed data in SandboxService matches the provided sample responses
- [ ] main.ts includes Swagger setup
- [ ] Docker files generated
- [ ] `npm run build` succeeds
- [ ] User receives summary with run instructions
</verification_checklist>
