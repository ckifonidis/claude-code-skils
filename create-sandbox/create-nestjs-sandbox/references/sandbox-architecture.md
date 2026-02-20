<architecture_overview>
The generated NestJS sandbox service follows a modular architecture with sandbox lifecycle management and controller-specific modules for each API group identified from the input data. Data is stored as normalized entities in an entity store, and controller services query entities to dynamically construct API responses. Entity types are discovered dynamically from the provided API data — they are NOT predetermined.
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
│   │   │   ├── sandbox-store.interface.ts # SandboxData, EntityStore, SandboxMetadata interfaces
│   │   │   └── entities.interface.ts     # Dynamically generated entity type interfaces
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
// Entity interfaces are generated dynamically from the parsed API response data.

interface EntityStore {
  // One Map per dynamically identified entity type, keyed by primary key
  [entityType: string]: Map<string, any>;
  // Entity types are discovered from the API data, NOT hardcoded.
  // Examples might include: customers, cards, accounts, loans, deposits,
  // transactions, merchants, branches, etc.
}

// SandboxMetadata holds dynamic relational lookup structures for efficient
// cross-entity queries. Internal-only — NOT included in serialized API responses.
interface SandboxMetadata {
  // Maps root entity key → { childEntityType → childEntityKeys[] }
  // Dynamically built based on discovered parent-child relationships
  parentChildRelations: Map<string, Record<string, string[]>>;

  // Maps entity type name → Map<entityKey, typeInfo>
  // Dynamically built for entity types that have type/category classifications
  typeGroupings: Record<string, Map<string, any>>;

  // Maps view name → Map<entityKey, preComputedData>
  // Dynamically built for entities that appear differently in aggregation responses
  preComputedViews: Record<string, Map<string, any>>;
}

interface SandboxData {
  sandboxId: string;
  createdAt: Date;
  entities: EntityStore;
  metadata: SandboxMetadata;
}

// IMPORTANT: Map objects serialize to empty {} with JSON.stringify.
// Define serialized counterparts (Map → Record) for API responses.
// Metadata is NOT included in serialized output — it's internal only.
type SerializedEntityStore = {
  [K in keyof EntityStore]: Record<string, any>;
};

interface SerializedSandboxData {
  sandboxId: string;
  createdAt: Date;
  entities: SerializedEntityStore;
}
```

**Key differences from static response storage:**
- Entities are normalized (flat, linked by keys) instead of nested per-endpoint
- Each entity type has its own Map, keyed by primary key
- Foreign keys link related entities (e.g., child entity stores parent's primary key)
- Entity types are dynamically discovered, not hardcoded
- Controller services query entities and construct responses dynamically

**Serialization requirement:**
- `Map` objects do NOT serialize to JSON — `JSON.stringify(new Map())` returns `"{}"`. NestJS uses JSON serialization for HTTP responses.
- The service uses `Map` internally for efficient lookups (get/set/delete by key), but must convert to `Record` (plain objects) before returning from API endpoints.
- `SandboxData` (with Maps) is the internal type. `SerializedSandboxData` (with Records) is the API return type.
- A private `serializeSandbox()` helper converts between the two.
</sandbox_data_structure>

<sandbox_service_pattern>
The SandboxService manages the entity store, provides entity access methods, and validates entities on add operations.
Public API methods (create, get, update, list) return `SerializedSandboxData` for JSON-safe responses.
Internal entity access methods (used by controller services) work with raw `Map`-based `SandboxData`.

The service imports `BadRequestException` and `ConflictException` alongside `Injectable` and `NotFoundException` from `@nestjs/common`.

The service defines three private data maps (populated from dynamically discovered entities):
1. **`primaryKeyMap`** - Maps entity type names to their primary key field names
2. **`entitySchemas`** - Maps entity types to required fields and their `typeof` types (for shape validation on add)
3. **`uniqueFieldsMap`** - Maps entity types to fields that must be unique within the collection

See `references/entity-model.md` `<entity_validation>` section for full details on how these maps are used and why validation is at the service level (not DTO level).

```typescript
@Injectable()
export class SandboxService {
  private sandboxes: Map<string, SandboxData> = new Map();

  // --- Data maps for validation and primary key resolution ---
  // These are populated based on whatever entities are discovered in the API data

  private readonly primaryKeyMap: Record<string, string> = {
    // Dynamically populated, e.g.: customers: 'customerCode', cards: 'cardNumber'
  };

  private readonly entitySchemas: Record<string, Record<string, string>> = {
    // Dynamically populated with required fields and typeof types per entity type
  };

  private readonly uniqueFieldsMap: Record<string, string[]> = {
    // Dynamically populated with unique field names per entity type
  };

  // --- Public API methods (return SerializedSandboxData) ---

  createSandbox(createDto: CreateSandboxDto): SerializedSandboxData {
    const sandboxId = createDto.sandboxId || uuidv4();
    const { entities, metadata } = this.generateSeedData();
    const sandboxData: SandboxData = {
      sandboxId,
      createdAt: new Date(),
      entities,
      metadata,
    };
    this.sandboxes.set(sandboxId, sandboxData);
    return this.serializeSandbox(sandboxData);
  }

  getSandbox(sandboxId: string): SerializedSandboxData {
    return this.serializeSandbox(this.getSandboxInternal(sandboxId));
  }

  listSandboxes(): SerializedSandboxData[] {
    return Array.from(this.sandboxes.values()).map((s) =>
      this.serializeSandbox(s),
    );
  }

  // --- Internal entity access methods (used by controller services) ---

  getEntities(sandboxId: string): EntityStore {
    return this.getSandboxInternal(sandboxId).entities;
  }

  getMetadata(sandboxId: string): SandboxMetadata {
    return this.getSandboxInternal(sandboxId).metadata;
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

  // --- Private methods ---

  private getSandboxInternal(sandboxId: string): SandboxData {
    const sandbox = this.sandboxes.get(sandboxId);
    if (!sandbox) {
      throw new NotFoundException(`Sandbox ${sandboxId} not found`);
    }
    return sandbox;
  }

  private serializeSandbox(sandbox: SandboxData): SerializedSandboxData {
    const entities = {} as SerializedSandboxData['entities'];
    for (const [key, map] of Object.entries(sandbox.entities)) {
      (entities as Record<string, Record<string, any>>)[key] =
        Object.fromEntries(map as Map<string, any>);
    }
    return {
      sandboxId: sandbox.sandboxId,
      createdAt: sandbox.createdAt,
      entities,
    };
  }

  private generateSeedData(): { entities: EntityStore; metadata: SandboxMetadata } {
    // {{SEED_DATA_BLOCK}}
    // Returns both entity Maps AND metadata populated from parsed API responses.
    // Entity types and metadata structures are determined by the discovered entities.
    //
    // Entities: Map<primaryKey, entityData> per discovered entity type.
    // Metadata:
    //   parentChildRelations: Map<rootKey, { childType: childKeys[] }>
    //   typeGroupings: { entityType: Map<entityKey, typeInfo> }
    //   preComputedViews: { viewName: Map<entityKey, preComputedData> }
    return {
      entities: {},
      metadata: {
        parentChildRelations: new Map(),
        typeGroupings: {},
        preComputedViews: {},
      },
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
Controller services query entities and metadata to build responses dynamically. Entity type names used in queries are determined by the discovered entities, not hardcoded.

```typescript
@Injectable()
export class ResourceService {
  constructor(private readonly sandboxService: SandboxService) {}

  // SEARCH PATTERN: Use findEntities with predicates, metadata for ownership checks
  async searchAction(sandboxId: string, requestDto: any): Promise<any> {
    const metadata = this.sandboxService.getMetadata(sandboxId);
    const { someFilter, parentKey } = requestDto.payload;

    const results = this.sandboxService.findEntities(sandboxId, 'discoveredEntityType',
      (entity: any) => {
        if (someFilter && entity.field !== someFilter) return false;
        if (parentKey) {
          const relations = metadata.parentChildRelations.get(entity.rootKey) || {};
          const childKeys = relations['discoveredEntityType'] || [];
          if (!childKeys.includes(parentKey)) return false;
        }
        return true;
      },
    );

    return {
      payload: { items: results.map(e => this.toResponseItem(e)), moreData: false },
      exception: null, messages: null, executionTime: 0.0,
    };
  }

  // AGGREGATION PATTERN: Use metadata for key lookups and type grouping
  async aggregateAction(sandboxId: string, requestDto: any): Promise<any> {
    const entities = this.sandboxService.getEntities(sandboxId);
    const metadata = this.sandboxService.getMetadata(sandboxId);
    const { rootEntityKey } = requestDto.payload;

    // Use parentChildRelations to find child entity keys
    const relations = metadata.parentChildRelations.get(rootEntityKey) || {};

    // Build product groups dynamically based on discovered child types
    const productGroups = [];
    for (const [childType, childKeys] of Object.entries(relations)) {
      const childEntities = childKeys
        .map(k => (entities[childType] as Map<string, any>)?.get(k))
        .filter(Boolean);

      // Use typeGroupings for this child type if available
      const typeMap = metadata.typeGroupings[childType];

      // Use preComputedViews if available
      const viewMap = metadata.preComputedViews[childType + 'Positions'];

      // ... build product group based on type grouping and view data
    }

    return {
      payload: { productGroups },
      exception: null, messages: null, executionTime: 0.0,
    };
  }

  // LOOKUP PATTERN: Get single entity, map with default fallbacks
  async lookupAction(sandboxId: string, requestDto: any): Promise<any> {
    const entity = this.sandboxService.getEntity(sandboxId, 'discoveredEntityType', requestDto.payload.id);
    if (!entity) {
      return { payload: null, exception: { message: 'Not found' }, executionTime: 0.0 };
    }
    return { payload: this.toDetailResponse(entity), exception: null, executionTime: 0.0 };
  }

  // DATE RANGE PATTERN: Filter by date, support related entity lookups
  async listByDateAction(sandboxId: string, requestDto: any): Promise<any> {
    const { parentId, dateFrom, dateTo } = requestDto.payload;
    let results = this.sandboxService.findEntities(sandboxId, 'childType',
      (e: any) => e.parentId === parentId,
    );
    if (dateFrom) results = results.filter(e => e.date >= dateFrom);
    if (dateTo) results = results.filter(e => e.date <= dateTo);
    return { payload: { items: results }, exception: null, executionTime: 0.0 };
  }

  // DEFAULT FALLBACK MAPPER: Use ?? for fields missing on some entities
  private toDetailResponse(entity: any): any {
    return {
      id: entity.id,
      status: entity.status ?? '00',
      name: entity.name ?? '',
      hasFullData: entity.hasFullData ?? false,
    };
  }

  // CONDITIONAL FIELD MAPPER: Only include optional fields when present
  private toResponseItem(entity: any): any {
    const result: any = { id: entity.id, name: entity.name };
    if (entity.optionalField !== undefined) result.optionalField = entity.optionalField;
    return result;
  }
}
```

**Response builder principles:**
- Request parameters drive filtering and lookups
- **Metadata** for cross-entity relationship lookups via `parentChildRelations`, type grouping via `typeGroupings`, and pre-computed views via `preComputedViews`
- Response format matches the original API sample responses exactly
- Entity fields populate the response with `?? defaultValue` fallbacks
- Conditional field inclusion for optional response fields
- Derived fields (counts, totals, flags) are computed at response time
- Missing entities return empty results, not errors
- Date range filtering for transaction/log endpoints
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
The PUT endpoint supports entity-level updates with validation. Entity type names are dynamic — they match whatever entity types were discovered:

```json
{
  "entities": {
    "{discoveredEntityType}": {
      "add": [{ "primaryKeyField": "999", "name": "New Entity", ... }],
      "update": { "existingKey": { "name": "Updated Name" } },
      "remove": ["old-entity-key"]
    },
    "{anotherDiscoveredType}": {
      "add": [{ "primaryKeyField": "1234567890", "parentKey": "999", ... }]
    }
  }
}
```

**Validation behavior (service-level, two-pass):**

Pass 1 validates all operations before any mutations:
- Unknown entity type → `BadRequestException` (400)
- Unknown operation keys (not `add`/`update`/`remove`) → `BadRequestException` (400)
- Entity shape validation on `add` (missing required fields, wrong types) → `BadRequestException` (400)
- Uniqueness constraint violations on `add` → `ConflictException` (409)

Pass 2 applies mutations only after all validations pass:
- `add`: Insert entities keyed by primary key
- `update`: Shallow-merge partial updates into existing entities (uses `...(updates as object)` to avoid TS2698)
- `remove`: Delete entities by primary key

**Important TypeScript note:** When spreading `updates` from `Object.entries()`, the value is typed as `any`. The spread operator on `any` causes `TS2698: Spread types may only be created from object types`. Fix with: `{ ...existing, ...(updates as object) }`.

This enables test scenarios like:
- Adding multiple entities to test search
- Modifying entity states to test different scenarios
- Removing entities to test empty-result scenarios
</update_sandbox_format>

<swagger_configuration>
The generated service includes full Swagger/OpenAPI documentation:

- **Title:** Generated from the API source (e.g., "Banking Sandbox API")
- **Version:** "1.0.0"
- **Description:** "Sandbox service with entity-based in-memory data for API testing"
- **Endpoint:** `/api` for Swagger UI, `/api-json` for OpenAPI spec
- All DTOs decorated with `@ApiProperty()`
- All controllers decorated with `@ApiTags()`
- All endpoints decorated with `@ApiOperation()` and `@ApiResponse()`
</swagger_configuration>

<module_wiring>
The AppModule imports all generated modules. Module names are derived from the discovered controllers:

```typescript
@Module({
  imports: [
    SandboxModule,
    // One module per discovered controller:
    // {ControllerA}Module,
    // {ControllerB}Module,
    // {ControllerC}Module,
    // ...etc
  ],
})
export class AppModule {}
```

Each controller module imports SandboxModule to access the shared SandboxService:

```typescript
@Module({
  imports: [SandboxModule],
  controllers: [{Controller}Controller],
  providers: [{Controller}Service],
})
export class {Controller}Module {}
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
