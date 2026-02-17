<architecture_overview>
The generated NestJS sandbox service follows a modular architecture with sandbox lifecycle management and controller-specific modules for each API group identified from the input data. Data is stored as normalized entities in an entity store, and controller services query entities to dynamically construct API responses.
</architecture_overview>

<project_structure>
```
sandbox-service/
├── src/
│   ├── main.ts                          # Bootstrap with Swagger
│   ├── app.module.ts                    # Root module importing all controller + sandbox modules
│   ├── common/
│   │   ├── dto/
│   │   │   └── api-header.dto.ts        # Shared API header DTO
│   │   ├── interfaces/
│   │   │   ├── sandbox-store.interface.ts # SandboxData, EntityStore interfaces
│   │   │   └── entities.interface.ts     # Entity type interfaces (CustomerEntity, CardEntity, etc.)
│   │   └── decorators/
│   │       └── sandbox-id.decorator.ts  # Extract sandboxId from header/param
│   ├── sandbox/
│   │   ├── sandbox.module.ts
│   │   ├── sandbox.controller.ts        # CRUD for sandbox lifecycle
│   │   ├── sandbox.service.ts           # Sandbox management + entity access methods
│   │   └── dto/
│   │       ├── create-sandbox.dto.ts
│   │       ├── update-sandbox.dto.ts
│   │       └── sandbox-response.dto.ts
│   └── controllers/
│       ├── {controller-name}/           # One per identified controller
│       │   ├── {controller}.module.ts
│       │   ├── {controller}.controller.ts
│       │   ├── {controller}.service.ts  # Queries entities, builds API responses
│       │   └── dto/
│       │       ├── {action}-request.dto.ts
│       │       └── {action}-response.dto.ts
│       └── ...
├── Dockerfile
├── docker-compose.yml
├── package.json
├── tsconfig.json
├── tsconfig.build.json
└── nest-cli.json
```
</project_structure>

<sandbox_data_structure>
```typescript
// The entity-based in-memory data structure

// Each entity type is a separate interface with a primary key
// and optional foreign keys linking to other entities.
// Entity interfaces are generated from the parsed API response data.

interface EntityStore {
  // One Map per identified entity type, keyed by primary key
  [entityType: string]: Map<string, any>;
  // Example:
  // customers: Map<string, CustomerEntity>;
  // cards: Map<string, CardEntity>;
  // accounts: Map<string, AccountEntity>;
}

interface SandboxData {
  sandboxId: string;
  createdAt: Date;
  entities: EntityStore;
}
```

**Key differences from static response storage:**
- Entities are normalized (flat, linked by keys) instead of nested per-endpoint
- Each entity type has its own Map, keyed by primary key
- Foreign keys link related entities (e.g., `CardEntity.customerCode` → `CustomerEntity`)
- Controller services query entities and construct responses dynamically
</sandbox_data_structure>

<sandbox_service_pattern>
The SandboxService manages the entity store and provides entity access methods:

```typescript
@Injectable()
export class SandboxService {
  private sandboxes: Map<string, SandboxData> = new Map();

  createSandbox(createDto: CreateSandboxDto): SandboxData {
    const sandboxId = createDto.sandboxId || uuidv4();
    const sandboxData: SandboxData = {
      sandboxId,
      createdAt: new Date(),
      entities: this.generateSeedEntities(),
    };
    this.sandboxes.set(sandboxId, sandboxData);
    return sandboxData;
  }

  // Entity access methods used by controller services
  getEntities(sandboxId: string): EntityStore {
    return this.getSandbox(sandboxId).entities;
  }

  getEntityCollection<T>(sandboxId: string, entityType: string): Map<string, T> {
    const entities = this.getEntities(sandboxId);
    return (entities[entityType] as Map<string, T>) || new Map();
  }

  getEntity<T>(sandboxId: string, entityType: string, primaryKey: string): T | undefined {
    return this.getEntityCollection<T>(sandboxId, entityType).get(primaryKey);
  }

  findEntities<T>(sandboxId: string, entityType: string, predicate: (entity: T) => boolean): T[] {
    return Array.from(this.getEntityCollection<T>(sandboxId, entityType).values()).filter(predicate);
  }

  private generateSeedEntities(): EntityStore {
    // {{SEED_ENTITIES_BLOCK}}
    // Populated with entity instances extracted from parsed API responses.
    // Each entity type is a Map keyed by primary key.
    return {
      customers: new Map(),
      cards: new Map(),
      accounts: new Map(),
    };
  }
}
```
</sandbox_service_pattern>

<controller_pattern>
Each controller follows this pattern:

```typescript
@ApiTags('{controller-name}')
@Controller('sandbox/:sandboxId/{controller-path}')
export class ResourceController {
  constructor(private readonly resourceService: ResourceService) {}

  @Post('{action-path}')
  @ApiOperation({ summary: '{Action description}' })
  async actionName(
    @Param('sandboxId') sandboxId: string,
    @Body() requestDto: ActionRequestDto,
  ): Promise<any> {
    return this.resourceService.handleAction(sandboxId, requestDto);
  }
}
```

**Key points:**
- All controller endpoints are prefixed with `/sandbox/:sandboxId/`
- The sandboxId param identifies which sandbox's entity store to query
- The controller service queries entities and builds the API response
- Request/response DTOs match the original API structure
</controller_pattern>

<controller_service_pattern>
Controller services query entities and build responses dynamically:

```typescript
@Injectable()
export class ResourceService {
  constructor(private readonly sandboxService: SandboxService) {}

  async handleAction(sandboxId: string, requestDto: any): Promise<any> {
    // 1. Extract lookup/filter parameters from request
    const { someId, someFilter } = requestDto.payload;

    // 2. Query entities from the store
    const entities = this.sandboxService.getEntities(sandboxId);
    let results = Array.from(entities.someEntityType.values());

    // 3. Filter based on request parameters
    if (someFilter) {
      results = results.filter(e => e.field === someFilter);
    }

    // 4. Build response in the original API format
    return {
      payload: {
        items: results.map(e => this.toResponseItem(e)),
        moreData: false,
      },
      exception: null,
      messages: null,
      executionTime: 0.0,
    };
  }

  // Map entity fields to the API response shape
  private toResponseItem(entity: any): any {
    return { /* map entity fields to match original API response */ };
  }
}
```

**Response builder principles:**
- Request parameters drive filtering and lookups
- Response format matches the original API sample responses exactly
- Entity fields populate the response
- Derived fields (counts, totals, flags) are computed at response time
- Missing entities return empty results, not errors
</controller_service_pattern>

<sandbox_controller_endpoints>
```
POST   /sandboxes                              → Create new sandbox with seed entities
GET    /sandboxes                              → List all sandboxes
GET    /sandboxes/:sandboxId                   → Get sandbox configuration and entity summary
PUT    /sandboxes/:sandboxId                   → Update sandbox entities (add/update/remove)
DELETE /sandboxes/:sandboxId                   → Delete sandbox and free memory

POST   /sandbox/:sandboxId/{controller}/{action}  → Controller-specific endpoints (query entities)
```
</sandbox_controller_endpoints>

<update_sandbox_format>
The PUT endpoint supports entity-level updates:

```json
{
  "entities": {
    "customers": {
      "add": [{ "customerCode": "999", "name": "New Customer", "taxNo": "111222333" }],
      "update": { "1317952138": { "name": "Updated Name" } },
      "remove": ["old-customer-code"]
    },
    "cards": {
      "add": [{ "cardNumber": "1234567890", "customerCode": "999", "cardStatus": "00" }]
    }
  }
}
```

This enables test scenarios like:
- Adding multiple customers to test search
- Modifying card statuses to test different states
- Removing entities to test empty-result scenarios
</update_sandbox_format>

<swagger_configuration>
The generated service includes full Swagger/OpenAPI documentation:

- **Title:** Generated from the API source (e.g., "NBG Sandbox API")
- **Version:** "1.0.0"
- **Description:** "Sandbox service with entity-based in-memory data for API testing"
- **Endpoint:** `/api` for Swagger UI, `/api-json` for OpenAPI spec
- All DTOs decorated with `@ApiProperty()`
- All controllers decorated with `@ApiTags()`
- All endpoints decorated with `@ApiOperation()` and `@ApiResponse()`
</swagger_configuration>

<module_wiring>
The AppModule imports all generated modules:

```typescript
@Module({
  imports: [
    SandboxModule,
    // One module per controller:
    CustomerModule,
    CardsModule,
    PositionModule,
    // ...etc
  ],
})
export class AppModule {}
```

Each controller module imports SandboxModule to access the shared SandboxService:

```typescript
@Module({
  imports: [SandboxModule],
  controllers: [CardsController],
  providers: [CardsService],
})
export class CardsModule {}
```

SandboxModule exports SandboxService so controller modules can inject it:

```typescript
@Global()
@Module({
  controllers: [SandboxController],
  providers: [SandboxService],
  exports: [SandboxService],
})
export class SandboxModule {}
```
</module_wiring>
