<entity_model_overview>
The entity-based data model replaces static per-endpoint responses with a normalized entity store. Instead of each endpoint returning a hardcoded response, entities are stored independently and linked by relationships. Controller services query the entity store and dynamically construct API responses based on request parameters.

Entity types are NOT predetermined — they are dynamically discovered by analyzing the provided API data. The skill identifies whatever banking entities exist (customers, cards, accounts, loans, deposits, merchants, transactions, branches, etc.) based on recurring identifiers across endpoints.

This enables realistic sandbox behavior:
- **Search** - Filter entities by field values (e.g., search by taxNo, accountNumber, branchCode)
- **Lookups** - Retrieve specific entities by primary key (e.g., fetch entity by its unique identifier)
- **Cross-entity queries** - Follow relationships to build composite responses (e.g., get all products for a parent entity)
- **Multiple records** - Return different results based on different inputs
</entity_model_overview>

<entity_identification>
## How to Identify Entities from API Data

Analyze all parsed API responses and request payloads to identify domain entities. Do NOT assume any specific entity types — discover them from the data.

### Step 1: Find Recurring Identifiers

Look for fields that appear across multiple endpoints as either:
- **Request parameters** (input) - fields used to look up data (e.g., `customerCode`, `cardNumber`, `accountNo`, `loanId`, `branchCode`)
- **Response identifiers** (output) - fields that uniquely identify records in response data

A field that appears as an input parameter in one endpoint AND as an identifier in another endpoint's response is a strong signal of an entity.

### Step 2: Define Entity Types Dynamically

For each recurring identifier, define an entity type. The entity type name should be derived from the data context (field names, URL segments, response structure):

```
Entity: {EntityName}   (e.g., Customer, Card, Account, Loan, Branch, Transaction)
  Primary Key: {fieldName} (the unique identifier)
  Source Endpoints: {list of endpoints where this entity's data appears}
  Fields: {all fields from the richest response containing this entity}
```

**Important:** Do NOT limit yourself to a fixed set of entity types. If the API data contains deposits, merchants, guarantees, insurance policies, standing orders, or any other banking entity — identify and model them.

### Step 3: Identify the Root Entity

The root entity is the one that:
- Other entities reference via foreign keys
- Is typically the first thing looked up in a workflow
- Has the broadest scope (e.g., a parent entity that child entities belong to)

Use `AskUserQuestion` to confirm the root entity with the user if there are multiple candidates.

### Step 4: Map Relationships

For each entity pair, determine:
- **One-to-many**: A parent entity has many child entities (e.g., Parent.parentKey → Child.parentKey)
- **One-to-one**: An entity has one associated detail record
- **Ownership**: Which entity "owns" the other (parent → child)

Relationships are inferred from:
- Fields in one entity that match the primary key of another entity
- Nested structures in API responses (e.g., `productGroups[].subProducts[]` suggests products belong to a parent)
- Request parameters that reference another entity (e.g., `fetchTransactions(entityId)` means transactions belong to that entity)
</entity_identification>

<entity_store_design>
## Entity Store Structure

Replace the flat `controllers → endpoint → seedResponse` structure with a normalized entity store plus metadata.

### Interface Design

```typescript
// src/common/interfaces/sandbox-store.interface.ts

// Each entity type gets its own interface — generated dynamically from API data
// Example interfaces (actual types depend on discovered entities):
//
// interface CustomerEntity {
//   customerCode: string;       // Primary key
//   name: string;
//   taxNo: string;
//   // ... all fields from the richest response
// }
//
// interface CardEntity {
//   cardNumber: string;         // Primary key
//   customerCode: string;       // Foreign key → root entity
//   cardStatus: string;
//   // ... all fields from card responses
// }

// The entity store holds all entities for a sandbox (internal, for Map-based lookups)
// Uses dynamic string keys — entity type names are discovered at generation time
interface EntityStore {
  [entityType: string]: Map<string, any>;
}

// SandboxMetadata holds dynamic relational lookup structures.
// Internal-only — NOT included in serialized API responses.
interface SandboxMetadata {
  // Maps root entity key → { childEntityType → childEntityKeys[] }
  // Example: parentChildRelations.get('1317952138') → { cards: ['527890...'], accounts: ['8175...'], loans: ['426...'] }
  parentChildRelations: Map<string, Record<string, string[]>>;

  // Maps entity type name → Map<entityKey, typeInfo>
  // Example: typeGroupings['accounts'] → Map('8175...', { code: '102', description: 'ΤΡΕΧΟΥΜΕΝΟΣ' })
  // Example: typeGroupings['cards'] → Map('5278...', { category: 'credit', typeCode: '301', typeDescription: 'ΠΙΣΤΩΤΙΚΗ' })
  typeGroupings: Record<string, Map<string, any>>;

  // Maps view name → Map<entityKey, preComputedData>
  // For entities that appear in aggregation responses in a different format than their entity shape
  // Example: preComputedViews['cardPositions'] → Map('4165...', { account: '4165...', description: 'VISA Classic', ... })
  preComputedViews: Record<string, Map<string, any>>;
}

// Internal representation (uses Maps for efficient lookups)
interface SandboxData {
  sandboxId: string;
  createdAt: Date;
  entities: EntityStore;
  metadata: SandboxMetadata;
}

// JSON-serializable versions (Map → Record) for API responses.
// Map objects serialize to {} with JSON.stringify, so API return types
// must use Record<string, any> instead of Map<string, any>.
// IMPORTANT: metadata is intentionally excluded from serialized output —
// it is internal-only and never exposed via the API.
type SerializedEntityStore = {
  [K in keyof EntityStore]: Record<string, any>;
};

interface SerializedSandboxData {
  sandboxId: string;
  createdAt: Date;
  entities: SerializedEntityStore;
}
```

### Design Rules

1. **Primary key as Map key** - Each entity Map is keyed by the entity's primary key field
2. **Foreign keys as fields** - Related entities store the parent's primary key as a field
3. **Flat storage** - Avoid nesting entities inside each other in the store; keep them flat and linked by keys
4. **Rich entities** - Merge fields from ALL endpoints that return data for the same entity type into a single entity interface. The entity should be a superset of all response fields for that type.
5. **Derived data stays out** - Fields that are computed at response time (like `moreData`, `executionTime`, `listCount`) are NOT stored on entities; they are added by response builders.
6. **Dynamic entity types** - The EntityStore uses string-keyed Maps. Entity type names are derived from the API data, not hardcoded.
</entity_store_design>

<entity_extraction>
## Extracting Entities from Seed Data

When generating the `generateSeedData()` method, extract entity instances from the provided API sample responses.

### Process

1. **Parse root entity data** from root-entity-related responses → create root entity instances
2. **Parse child entity data** from child-entity-related responses → create child entity instances, linking to root entity via foreign key
3. **Parse sub-entities** (transactions, logs, details, etc.) → either embed in parent entity or create separate entity Maps
4. **Build parentChildRelations** — for each root entity instance, collect arrays of child entity keys grouped by child type
5. **Build typeGroupings** — for entities that have type/category fields in aggregation responses, map entity keys to type info
6. **Build preComputedViews** — for entities that appear in aggregation responses in a different shape, store pre-computed fragments

### Example: Extracting from Sample Data

Given a search response containing entity records:
```json
{ "payload": { "items": [{ "entityId": "123456", "name": "...", "taxNo": "140700917", ... }] } }
```

Extract:
```typescript
entityCollection.set('123456', {
  entityId: '123456',
  name: '...',
  taxNo: '140700917',
  // ... all other fields from the item
});
```

Given an aggregation response with nested sub-products:
```json
{ "payload": { "productGroups": [{ "description": "Group Name", "subProducts": [{ "account": "5278900043068407", ... }] }] } }
```

Extract:
```typescript
childCollection.set('5278900043068407', {
  primaryKey: '5278900043068407',
  parentEntityKey: '123456',  // Link to the parent
  description: 'Sub-product Name',
  // ... fields from sub-product
});
```

### Merging Entity Data from Multiple Endpoints

The same entity may appear in multiple API responses with different fields. Merge all available fields into the entity:

- Endpoint A provides: `entityId`, `description`, `amount`, `availableBalance`
- Endpoint B provides: `entityId`, `status`, `limits`, `security`, `expirationDate`
- Endpoint C provides: `entityId`, `detailStatus`, `availableActions`

The entity interface should contain ALL of these fields merged together.
</entity_extraction>

<response_builders>
## Response Builder Pattern

Controller services no longer return static seed responses. Instead, they query the entity store and construct API responses dynamically.

### Pattern

```typescript
@Injectable()
export class SomeControllerService {
  constructor(private readonly sandboxService: SandboxService) {}

  async searchEntities(sandboxId: string, requestDto: SearchRequestDto): Promise<any> {
    const metadata = this.sandboxService.getMetadata(sandboxId);
    const { filterField, parentEntityKey } = requestDto.payload;

    // Use findEntities with predicate for search filtering
    const results = this.sandboxService.findEntities(sandboxId, 'entityTypeName',
      (entity: any) => {
        if (!filterField || entity.filterField !== filterField) return false;

        // If parent key provided, use metadata to check ownership
        if (parentEntityKey) {
          const parentRelations = metadata.parentChildRelations.get(entity.rootEntityKey) || {};
          const childKeys = parentRelations['entityTypeName'] || [];
          if (!childKeys.includes(entity.primaryKey)) return false;
        }

        return true;
      },
    );

    // Build response in API format
    return {
      payload: {
        items: results.map(e => this.toSearchItem(e)),
        moreData: false,
        tokenType: null,
      },
      exception: null,
      messages: null,
      executionTime: 0.0,
    };
  }

  private toSearchItem(entity: any): any {
    return {
      // Map entity fields to the API response shape
      // Convert types as needed (e.g., string → number for response)
    };
  }
}
```

### Cross-Entity Response Building (Metadata-Driven)

For endpoints that combine data from multiple entity types, use metadata for efficient lookups instead of scanning all entities:

```typescript
async getAggregatedProducts(sandboxId: string, requestDto: any): Promise<any> {
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

    // Use preComputedViews if available for this type
    const viewMap = metadata.preComputedViews[childType + 'Positions'];

    // Group and build product group response
    // ... build based on typeMap and viewMap data
  }

  return {
    payload: { productGroups },
    exception: null,
    messages: null,
    executionTime: 0.0,
  };
}
```

### Key Principles

1. **Request parameters drive filtering** - Use request payload fields to filter/lookup entities
2. **Response format preserved** - The API response structure matches the original sample responses exactly
3. **Entity data populates response** - Entity fields are mapped into the response format
4. **Derived fields computed** - Fields like `total`, `listCount`, `moreData` are computed at response time, not stored on entities
5. **Null handling** - If an entity or relationship is not found, return appropriate empty responses (empty arrays, null fields) rather than throwing errors
</response_builders>

<sandbox_service_entity_methods>
## SandboxService Entity Access Methods

The SandboxService provides entity access methods that controller services use:

```typescript
// Get the entire entity store for a sandbox
getEntities(sandboxId: string): EntityStore {
  const sandbox = this.getSandboxInternal(sandboxId);
  return sandbox.entities;
}

// Get all entities of a specific type
getEntityCollection<T>(sandboxId: string, entityType: string): Map<string, T> {
  const entities = this.getEntities(sandboxId);
  return (entities[entityType] as Map<string, T>) || new Map();
}

// Get a single entity by primary key
getEntity<T>(sandboxId: string, entityType: string, primaryKey: string): T | undefined {
  const collection = this.getEntityCollection<T>(sandboxId, entityType);
  return collection.get(primaryKey);
}

// Find entities matching a predicate
findEntities<T>(sandboxId: string, entityType: string, predicate: (entity: T) => boolean): T[] {
  const collection = this.getEntityCollection<T>(sandboxId, entityType);
  return Array.from(collection.values()).filter(predicate);
}

// Get the metadata for relational lookups and type groupings
getMetadata(sandboxId: string): SandboxMetadata {
  return this.getSandboxInternal(sandboxId).metadata;
}
```
</sandbox_service_entity_methods>

<update_sandbox_entities>
## Updating Sandbox Entities via PUT /sandboxes/:sandboxId

The update endpoint should allow adding, modifying, or removing entities of any discovered type:

```typescript
// PUT body structure — entity type keys are dynamic
{
  "entities": {
    "{entityTypeName}": {
      "add": [{ "primaryKeyField": "999", "name": "New Entity", ... }],
      "update": { "existingKey": { "name": "Updated Name" } },
      "remove": ["old-entity-key"]
    },
    "{anotherEntityType}": {
      "add": [{ "primaryKeyField": "1234567890", "parentKey": "999", ... }]
    }
  }
}
```

This allows test scenarios to:
- Add multiple entities to test search functionality
- Modify entity fields to test different states (e.g., blocked, inactive, suspended)
- Remove entities to test empty-result scenarios
</update_sandbox_entities>

<entity_validation>
## Entity Validation on Add Operations

When entities are added via the PUT update endpoint, they must be validated before storage. Validation occurs at the **service level** (not via class-validator DTOs) because the request body uses dynamic keys (`Record<string, any>`) that class-validator cannot introspect.

### Why Service-Level Validation (Not DTO-Level)

NestJS's `@ValidateNested()` + `@Type(() => SomeDto)` does **NOT** work correctly with `Record<string, SomeDto>`. When applied to a record type, class-transformer treats the entire Record object as the DTO instance (checking keys like entity type names against the DTO's properties) rather than validating each value independently. This causes legitimate requests to fail with `"property {entityType} should not exist"`.

The correct approach:
- The `UpdateSandboxDto.entities` field is typed as `Record<string, any>` (no `@ValidateNested`, no `@Type`)
- Only `@IsOptional()` and `@IsObject()` decorators are applied at the DTO level
- All operation-level and entity-level validation is performed in `SandboxService.updateSandbox()`

### Entity Schema Validation

Define an `entitySchemas` map on the service that maps each discovered entity type to its required fields and their expected `typeof` types:

```typescript
// Populated dynamically based on discovered entities
private readonly entitySchemas: Record<string, Record<string, string>> = {
  // Generated per entity type — example:
  // entityTypeA: {
  //   primaryKeyField: 'string', name: 'string', taxNo: 'string',
  //   branch: 'object', type: 'string', status: 'string',
  // },
  // entityTypeB: {
  //   primaryKeyField: 'string', parentKey: 'string',
  // },
};
```

The `validateEntityShape()` method checks each entity in an `add` operation:
1. Entity must be a non-null object
2. All required fields (from schema) must be present and not `undefined`
3. Each field's `typeof` must match the expected type (null is allowed for any field)

### Uniqueness Constraints

Define a `uniqueFieldsMap` that specifies which fields must be unique within each entity collection:

```typescript
// Populated dynamically based on discovered entities
private readonly uniqueFieldsMap: Record<string, string[]> = {
  // Generated per entity type — typically includes primary key and natural keys
  // entityTypeA: ['primaryKeyField', 'naturalKey'],
  // entityTypeB: ['primaryKeyField'],
};
```

The `validateUniqueFields()` method checks:
- New entities don't duplicate existing values for unique fields
- New entities within the same batch don't duplicate each other

Uniqueness violations throw `ConflictException` (HTTP 409).

### Validation Order in updateSandbox()

The update method uses a **two-pass pattern** for atomicity:

1. **Pass 1 (Validate)**: Iterate all entity types and operations, validating:
   - Entity type exists in the store → `BadRequestException`
   - Operation keys are valid (only `add`, `update`, `remove`) → `BadRequestException`
   - Entity shape validation on `add` → `BadRequestException`
   - Uniqueness constraints on `add` → `ConflictException`
2. **Pass 2 (Mutate)**: Only if all validations pass, apply all mutations

This prevents partial updates where some entity types are mutated before a validation error on a later entity type.
</entity_validation>

<metadata_system>
## Metadata: Dynamic Relational Lookups and Type Groupings

Alongside the EntityStore, each sandbox maintains a `SandboxMetadata` object. Metadata contains dynamically-built relational structures that controller services use for efficient cross-entity queries, type groupings, and aggregation response building.

**Metadata is internal-only** — it is NOT included in the serialized API response (`SerializedSandboxData` contains only `sandboxId`, `createdAt`, and `entities`).

### When to Use Metadata vs Direct Entity Queries

| Use Metadata | Use Direct Entity Queries |
|---|---|
| Finding which child entities belong to a parent (e.g., "which child entities belong to root entity X?") | Searching/filtering entities by field values |
| Grouping entities by type/category for product views | Looking up a single entity by primary key |
| Building aggregation responses | Filtering by date ranges or other field predicates |
| Pre-computed sub-product/position data for complex responses | Simple entity-to-response mapping |

### Metadata Structure (Dynamic)

**1. Parent-Child Relationship Map (`parentChildRelations`)**

Maps the root entity's primary key to a Record of child entity type → child key arrays. The child types are dynamically discovered — NOT hardcoded.

```typescript
parentChildRelations: Map<string, Record<string, string[]>>;
// Example:
// '1317952138' → {
//   accounts: ['81751218256', '39174651651'],
//   cards: ['4165810002021702', '5351420106817053'],
//   loans: ['4262838315'],
//   // ... any other child entity types discovered
// }
```

Usage in controller services:
```typescript
const metadata = this.sandboxService.getMetadata(sandboxId);
const relations = metadata.parentChildRelations.get(rootEntityKey) || {};
const childKeys = relations['childEntityType'] || [];
// Then fetch each child: childKeys.map(key => entities['childEntityType'].get(key))
```

**2. Type Grouping Maps (`typeGroupings`)**

A Record keyed by entity type name, each containing a Map from entity primary key to its type/category information. Used for organizing entities into product groups or categories in aggregation responses.

```typescript
typeGroupings: Record<string, Map<string, any>>;
// Example:
// typeGroupings['accounts'] → Map(
//   '81751218256' → { code: '102', description: 'ΤΡΕΧΟΥΜΕΝΟΣ' },
//   '39174651651' → { code: '100', description: 'ΤΑΜΙΕΥΤΗΡΙΟ' },
// )
// typeGroupings['cards'] → Map(
//   '4165810002021702' → { category: 'debit', typeCode: '300', typeDescription: 'ΧΡΕΩΣΤΙΚΗ' },
// )
```

Usage for product grouping:
```typescript
const typeMap = metadata.typeGroupings['entityType'];
if (typeMap) {
  const groupMap = new Map<string, any[]>();
  for (const key of entityKeys) {
    const entity = entities['entityType'].get(key);
    const typeInfo = typeMap.get(key);
    const groupKey = typeInfo?.code || 'unknown';
    if (!groupMap.has(groupKey)) groupMap.set(groupKey, []);
    groupMap.get(groupKey).push({ ...entity, typeInfo });
  }
}
```

**3. Pre-computed Views (`preComputedViews`)**

A Record keyed by a view name, each containing a Map from entity primary key to pre-computed response fragments. Used when an aggregation endpoint returns entity data in a different format than the entity's own shape.

```typescript
preComputedViews: Record<string, Map<string, any>>;
// Example:
// preComputedViews['cardPositions'] → Map(
//   '4165810002021702' → { account: '4165810002021702', description: 'VISA Classic', ... },
// )
```

This avoids re-computing complex response transformations at query time.

### Identifying Metadata from API Data

During entity identification (Step 3 of the workflow):

1. **Identify parent-child relationships** → populate `parentChildRelations` with whatever child types are discovered
2. **Identify type/category fields** in aggregation responses → populate `typeGroupings` for relevant entity types
3. **Identify sub-product shapes** that differ from entity shapes → populate `preComputedViews`
4. **Map entity keys to type info** from the seed data sample responses

### Metadata Generation in generateSeedData()

Metadata structures are populated alongside entity Maps from the same sample data:

```typescript
// When seeding a child entity, also populate:
// 1. parentChildRelations: add child key to the parent's child list for this type
// 2. typeGroupings[childType]: map child key to its category/type info (if applicable)
// 3. preComputedViews[viewName]: store pre-computed response shape (if applicable)
```
</metadata_system>

<response_mapper_patterns>
## Response Mapper Patterns

Controller services use private mapper methods to convert entity data to API response format. The actual project uses several patterns:

### Default Fallback Pattern
Use `?? defaultValue` for fields that may not exist on all entities:

```typescript
private toDetailResponse(entity: any): any {
  return {
    primaryKey: entity.primaryKey,
    status: entity.status ?? '00',
    name: entity.name ?? '',
    hasFullData: entity.hasFullData ?? false,
    // ... all fields with ?? defaults for missing data
  };
}
```

### Conditional Field Inclusion Pattern
Only include optional fields when they have values:

```typescript
private toTransactionItem(entity: any): any {
  const result: any = {
    transactionId: entity.transactionId,
    transactionDate: entity.transactionDate,
    amount: entity.amount,
  };
  // Only include optional fields if they exist
  if (entity.currency !== undefined) {
    result.currency = entity.currency;
  }
  if (entity.regionCode) {
    result.regionCode = entity.regionCode;
  }
  return result;
}
```

### Date Range Filtering Pattern
Filter entities by date range from request parameters:

```typescript
let results = this.sandboxService.findEntities(sandboxId, 'transactions',
  (tx: any) => tx.parentKey === parentEntityKey,
);

if (dateFrom) {
  results = results.filter(tx => tx.transactionDate >= dateFrom);
}
if (dateTo) {
  results = results.filter(tx => tx.transactionDate <= dateTo);
}
```

### Related Entity Lookup Pattern
When filtering by a key, also check related entity fields:

```typescript
const entity = this.sandboxService.getEntity(sandboxId, 'entityType', lookupKey);
const relatedKey = entity?.relatedEntityKey;

let results = this.sandboxService.findEntities(sandboxId, 'childType',
  (child: any) => child.parentKey === lookupKey ||
    (relatedKey && child.parentKey === relatedKey),
);
```
</response_mapper_patterns>
