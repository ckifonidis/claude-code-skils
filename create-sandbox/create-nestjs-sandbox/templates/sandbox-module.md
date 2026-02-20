<sandbox_module_template>
```typescript
// src/sandbox/sandbox.module.ts
import { Global, Module } from '@nestjs/common';
import { SandboxController } from './sandbox.controller';
import { SandboxService } from './sandbox.service';

@Global()
@Module({
  controllers: [SandboxController],
  providers: [SandboxService],
  exports: [SandboxService],
})
export class SandboxModule {}
```
</sandbox_module_template>

<sandbox_store_interfaces_template>
```typescript
// src/common/interfaces/sandbox-store.interface.ts

// EntityStore holds all entity collections for a sandbox.
// Each entity type is a Map keyed by its primary key.
// Used internally for efficient lookups (get/set/delete).
// Entity types are dynamically discovered from the API data — NOT hardcoded.
export interface EntityStore {
  [entityType: string]: Map<string, any>;
  // Generated entity Maps go here — one per discovered entity type.
  // Entity type names are derived from the API data analysis.
  // Examples (banking domain): customers, cards, accounts, loans, deposits,
  // transactions, merchants, standingOrders, etc.
}

// SandboxMetadata holds dynamic relational lookup structures that controller
// services use for efficient cross-entity queries and product grouping.
// This is internal-only data — NOT included in serialized API responses.
//
// {{METADATA_INTERFACE_BLOCK}}
// The SandboxMetadata interface uses three dynamic structures that are
// populated based on whatever entities and relationships are discovered:
//
// export interface SandboxMetadata {
//   // Maps root entity key → { childEntityType → childEntityKeys[] }
//   // Built from discovered parent-child relationships
//   parentChildRelations: Map<string, Record<string, string[]>>;
//
//   // Maps entity type name → Map<entityKey, typeInfo>
//   // Built for entity types that have type/category classifications
//   typeGroupings: Record<string, Map<string, any>>;
//
//   // Maps view name → Map<entityKey, preComputedData>
//   // Built for entities that appear in different shapes in aggregation responses
//   preComputedViews: Record<string, Map<string, any>>;
// }
//
// Design rules:
// 1. parentChildRelations maps the root entity's primary key to child type → key arrays
// 2. typeGroupings keys by the entity type name, values map entity key → type info
// 3. preComputedViews keys by view name, values map entity key → pre-computed data
// 4. All Maps use string keys for consistency
// 5. All three structures are dynamically populated — no hardcoded entity types

export interface SandboxData {
  sandboxId: string;
  createdAt: Date;
  entities: EntityStore;
  metadata: SandboxMetadata;
}

// JSON-serializable versions (Map → Record) for API responses.
// Map objects serialize to {} with JSON.stringify, so all API
// return types must use these instead of the Map-based versions.
// IMPORTANT: metadata is NOT included in serialized output.
export type SerializedEntityStore = {
  [K in keyof EntityStore]: Record<string, any>;
};

export interface SerializedSandboxData {
  sandboxId: string;
  createdAt: Date;
  entities: SerializedEntityStore;
}
```

```typescript
// src/common/interfaces/entities.interface.ts
// {{ENTITY_INTERFACES_BLOCK}}
// Generate one interface per dynamically identified entity type.
// Entity types are NOT predetermined — they are discovered from the API data.
// Each interface has:
// - A primary key field (used as the Map key)
// - Foreign key fields linking to parent entities
// - All data fields merged from every API response containing this entity
//
// Example (banking domain — actual types depend on API data):
//
// export interface CustomerEntity {
//   customerCode: string;       // Primary key
//   name: string;
//   taxNo: string;
//   branch: { code: string; name: string; };
//   type: string;
//   activityStatus: string;
// }
//
// export interface CardEntity {
//   cardNumber: string;         // Primary key
//   customerCode: string;       // Foreign key → parent entity
//   cardStatus: string;
//   productName: string;
//   // ... merged fields from all card-related endpoints
// }
//
// export interface LoanEntity {
//   loanAccountKey: string;     // Primary key
//   customerCode: string;       // Foreign key → parent entity
//   loanType: string;
//   balance: string;
//   // ... fields from loan-related endpoints
// }
//
// ... generate interfaces for ALL discovered entity types
```

**Entity interface generation rules:**
1. Primary key field is always `string` type (convert numbers to strings)
2. Foreign key fields reference another entity's primary key
3. Merge fields from all API responses that contain this entity's data
4. Use optional (`?`) for fields that only appear in some responses
5. Preserve exact field names and nesting from the original API data
6. Nested objects (like `limits`, `security`, `branch`) become inline type definitions or separate interfaces
7. Entity type names are derived from the API data context — do NOT assume fixed types
</sandbox_store_interfaces_template>

<sandbox_service_template>
```typescript
// src/sandbox/sandbox.service.ts
import { BadRequestException, ConflictException, Injectable, NotFoundException } from '@nestjs/common';
import { v4 as uuidv4 } from 'uuid';
import {
  SandboxData,
  SerializedSandboxData,
  EntityStore,
  SandboxMetadata,
} from '../common/interfaces/sandbox-store.interface';
import { CreateSandboxDto } from './dto/create-sandbox.dto';
import { UpdateSandboxDto } from './dto/update-sandbox.dto';

@Injectable()
export class SandboxService {
  private sandboxes: Map<string, SandboxData> = new Map();

  // {{UNIQUE_FIELDS_MAP}}
  // Maps entity types to fields that must be unique within the collection.
  // Populated based on discovered entities. Used by validateUniqueFields().
  private readonly uniqueFieldsMap: Record<string, string[]> = {
    // Dynamically generated per entity type, e.g.:
    // entityTypeA: ['primaryKeyField', 'naturalKeyField'],
    // entityTypeB: ['primaryKeyField'],
  };

  // {{PRIMARY_KEY_MAP}}
  // Maps entity type names to their primary key field names.
  // Populated based on discovered entities.
  private readonly primaryKeyMap: Record<string, string> = {
    // Dynamically generated, e.g.: entityTypeA: 'entityId', entityTypeB: 'entityKey'
  };

  // {{ENTITY_SCHEMAS}}
  // Maps each entity type to its required fields and their typeof types.
  // Populated based on discovered entities. Used by validateEntityShape().
  private readonly entitySchemas: Record<string, Record<string, string>> = {
    // Dynamically generated per entity type, e.g.:
    // entityTypeA: {
    //   entityId: 'string', name: 'string', status: 'string',
    //   details: 'object',
    // },
    // entityTypeB: {
    //   entityKey: 'string', parentKey: 'string',
    // },
  };

  // --- Public API methods (return SerializedSandboxData for JSON-safe responses) ---

  createSandbox(createDto: CreateSandboxDto): SerializedSandboxData {
    const sandboxId = createDto.sandboxId || uuidv4();

    if (this.sandboxes.has(sandboxId)) {
      throw new Error(`Sandbox ${sandboxId} already exists`);
    }

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

  updateSandbox(sandboxId: string, updateDto: UpdateSandboxDto): SerializedSandboxData {
    const sandbox = this.getSandboxInternal(sandboxId);

    if (updateDto.entities) {
      const entries = Object.entries(updateDto.entities);

      // --- Pass 1: Validate everything before any mutations ---
      const validOps = new Set(['add', 'update', 'remove']);
      for (const [entityType, operations] of entries) {
        const collection = sandbox.entities[entityType];
        if (!collection) {
          throw new BadRequestException(`Unknown entity type: '${entityType}'`);
        }

        const unknownOps = Object.keys(operations).filter(k => !validOps.has(k));
        if (unknownOps.length > 0) {
          throw new BadRequestException(
            `Unknown operation(s) in '${entityType}': ${unknownOps.map(k => `'${k}'`).join(', ')}. Valid operations are: add, update, remove`,
          );
        }

        if (operations.add) {
          this.validateEntityShape(entityType, operations.add);
          this.validateUniqueFields(entityType, collection, operations.add);
        }
      }

      // --- Pass 2: Apply all mutations (validation already passed) ---
      for (const [entityType, operations] of entries) {
        const collection = sandbox.entities[entityType];

        if (operations.add) {
          for (const entity of operations.add) {
            const primaryKey = this.getPrimaryKey(entityType, entity);
            collection.set(primaryKey, entity);
          }
        }

        if (operations.update) {
          for (const [key, updates] of Object.entries(
            operations.update as Record<string, any>,
          )) {
            const existing = collection.get(key);
            if (existing) {
              collection.set(key, { ...existing, ...(updates as object) });
            }
          }
        }

        if (operations.remove) {
          for (const key of operations.remove) {
            collection.delete(key);
          }
        }
      }
    }

    return this.serializeSandbox(sandbox);
  }

  deleteSandbox(sandboxId: string): void {
    if (!this.sandboxes.delete(sandboxId)) {
      throw new NotFoundException(`Sandbox ${sandboxId} not found`);
    }
  }

  listSandboxes(): SerializedSandboxData[] {
    return Array.from(this.sandboxes.values()).map((s) =>
      this.serializeSandbox(s),
    );
  }

  // --- Entity access methods used by controller services (internal, Map-based) ---

  getEntities(sandboxId: string): EntityStore {
    return this.getSandboxInternal(sandboxId).entities;
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

  // Get the metadata for a sandbox (used by controller services for
  // relational lookups, type groupings, and pre-computed views)
  getMetadata(sandboxId: string): SandboxMetadata {
    return this.getSandboxInternal(sandboxId).metadata;
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

  private validateEntityShape(entityType: string, entities: any[]): void {
    const schema = this.entitySchemas[entityType];
    if (!schema) {
      throw new BadRequestException(`Unknown entity type: '${entityType}'`);
    }

    for (let i = 0; i < entities.length; i++) {
      const entity = entities[i];
      if (typeof entity !== 'object' || entity === null) {
        throw new BadRequestException(
          `${entityType}[${i}]: expected an object, got ${typeof entity}`,
        );
      }
      for (const [field, expectedType] of Object.entries(schema)) {
        if (!(field in entity) || entity[field] === undefined) {
          throw new BadRequestException(
            `${entityType}[${i}]: missing required field '${field}'`,
          );
        }
        const actualType = typeof entity[field];
        // Allow null for any field (nullable types)
        if (entity[field] !== null && actualType !== expectedType) {
          throw new BadRequestException(
            `${entityType}[${i}]: field '${field}' expected ${expectedType}, got ${actualType}`,
          );
        }
      }
    }
  }

  private validateUniqueFields(
    entityType: string,
    collection: Map<string, any>,
    newEntities: any[],
  ): void {
    const uniqueFields = this.uniqueFieldsMap[entityType];
    if (!uniqueFields) return;

    const existingEntities = Array.from(collection.values());

    for (const field of uniqueFields) {
      const existingSet = new Set<string>();
      for (const entity of existingEntities) {
        if (entity[field] != null) {
          existingSet.add(String(entity[field]));
        }
      }

      const batchSet = new Set<string>();
      for (const entity of newEntities) {
        if (entity[field] == null) continue;
        const value = String(entity[field]);

        if (existingSet.has(value)) {
          throw new ConflictException(
            `Entity with ${field} '${value}' already exists in ${entityType}`,
          );
        }
        if (batchSet.has(value)) {
          throw new ConflictException(
            `Duplicate ${field} '${value}' within the same add batch for ${entityType}`,
          );
        }
        batchSet.add(value);
      }
    }
  }

  private getPrimaryKey(entityType: string, entity: any): string {
    const keyField = this.primaryKeyMap[entityType];
    return keyField ? String(entity[keyField]) : entity.id || uuidv4();
  }

  private generateSeedData(): { entities: EntityStore; metadata: SandboxMetadata } {
    // {{SEED_DATA_BLOCK}}
    // Extract entity instances AND metadata from parsed API sample responses.
    // Entity types are dynamically determined from the API data.
    //
    // Part 1: Entity Maps (one per discovered entity type, keyed by primary key)
    // const entityTypeA = new Map<string, any>();
    // entityTypeA.set('key1', { primaryKeyField: 'key1', name: '...', ... });
    //
    // const entityTypeB = new Map<string, any>();
    // entityTypeB.set('key2', { primaryKeyField: 'key2', parentKey: 'key1', ... });
    //
    // Part 2: Metadata (dynamic relational structures)
    // const parentChildRelations = new Map<string, Record<string, string[]>>();
    // parentChildRelations.set('key1', {
    //   entityTypeB: ['key2', 'key3'],
    //   entityTypeC: ['key4'],
    //   // ... one entry per discovered child type
    // });
    //
    // const typeGroupings: Record<string, Map<string, any>> = {};
    // typeGroupings['entityTypeB'] = new Map([
    //   ['key2', { code: '102', description: 'Type A' }],
    //   ['key3', { code: '100', description: 'Type B' }],
    // ]);
    //
    // const preComputedViews: Record<string, Map<string, any>> = {};
    // preComputedViews['entityTypeBPositions'] = new Map([
    //   ['key2', { /* pre-computed sub-product data */ }],
    // ]);
    //
    // return {
    //   entities: { entityTypeA, entityTypeB, entityTypeC, ... },
    //   metadata: { parentChildRelations, typeGroupings, preComputedViews },
    // };

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

**Placeholders:**
- `{{SEED_DATA_BLOCK}}` - Replace `return { entities: {}, metadata: { ... } }` with entity Maps AND metadata populated from parsed API responses. Entity types are dynamically determined. Metadata includes: (1) `parentChildRelations` — root entity key to child type → child key arrays, (2) `typeGroupings` — entity type name to entity key → type info, (3) `preComputedViews` — view name to entity key → pre-computed data.
- `{{PRIMARY_KEY_MAP}}` - Replace the empty `primaryKeyMap` object with mappings from discovered entity type names to their primary key field names.
- `{{UNIQUE_FIELDS_MAP}}` - Replace the empty `uniqueFieldsMap` object with discovered entity types mapped to their unique field names.
- `{{ENTITY_SCHEMAS}}` - Replace the empty `entitySchemas` object with required fields per discovered entity type.
- `{{METADATA_INTERFACE_BLOCK}}` - Replace the commented example in `sandbox-store.interface.ts` with the actual `SandboxMetadata` interface (always uses the three dynamic structures: `parentChildRelations`, `typeGroupings`, `preComputedViews`).
</sandbox_service_template>

<sandbox_controller_template>
```typescript
// src/sandbox/sandbox.controller.ts
import {
  Controller, Get, Post, Put, Delete,
  Param, Body, HttpCode, HttpStatus,
} from '@nestjs/common';
import {
  ApiTags, ApiOperation, ApiParam, ApiBody, ApiResponse,
} from '@nestjs/swagger';
import { SandboxService } from './sandbox.service';
import { SerializedSandboxData } from '../common/interfaces/sandbox-store.interface';
import { CreateSandboxDto } from './dto/create-sandbox.dto';
import { UpdateSandboxDto } from './dto/update-sandbox.dto';

@ApiTags('sandboxes')
@Controller('sandboxes')
export class SandboxController {
  constructor(private readonly sandboxService: SandboxService) {}

  @Post()
  @ApiOperation({ summary: 'Create a new sandbox with seed entities' })
  @ApiBody({ type: CreateSandboxDto })
  @ApiResponse({ status: 201, description: 'Sandbox created successfully' })
  create(@Body() createDto: CreateSandboxDto): SerializedSandboxData {
    return this.sandboxService.createSandbox(createDto);
  }

  @Get()
  @ApiOperation({ summary: 'List all sandboxes' })
  @ApiResponse({ status: 200, description: 'List of all sandboxes' })
  findAll(): SerializedSandboxData[] {
    return this.sandboxService.listSandboxes();
  }

  @Get(':sandboxId')
  @ApiOperation({ summary: 'Get sandbox configuration and entity summary' })
  @ApiParam({ name: 'sandboxId', description: 'The sandbox identifier' })
  @ApiResponse({ status: 200, description: 'Sandbox data' })
  @ApiResponse({ status: 404, description: 'Sandbox not found' })
  findOne(@Param('sandboxId') sandboxId: string): SerializedSandboxData {
    return this.sandboxService.getSandbox(sandboxId);
  }

  @Put(':sandboxId')
  @ApiOperation({ summary: 'Update sandbox entities (add, update, or remove)' })
  @ApiParam({ name: 'sandboxId', description: 'The sandbox identifier' })
  @ApiBody({ type: UpdateSandboxDto })
  @ApiResponse({ status: 200, description: 'Sandbox updated' })
  @ApiResponse({ status: 404, description: 'Sandbox not found' })
  update(
    @Param('sandboxId') sandboxId: string,
    @Body() updateDto: UpdateSandboxDto,
  ): SerializedSandboxData {
    return this.sandboxService.updateSandbox(sandboxId, updateDto);
  }

  @Delete(':sandboxId')
  @HttpCode(HttpStatus.NO_CONTENT)
  @ApiOperation({ summary: 'Delete a sandbox' })
  @ApiParam({ name: 'sandboxId', description: 'The sandbox identifier' })
  @ApiResponse({ status: 204, description: 'Sandbox deleted' })
  @ApiResponse({ status: 404, description: 'Sandbox not found' })
  remove(@Param('sandboxId') sandboxId: string): void {
    this.sandboxService.deleteSandbox(sandboxId);
  }
}
```
</sandbox_controller_template>

<sandbox_dtos_template>
```typescript
// src/sandbox/dto/create-sandbox.dto.ts
import { ApiPropertyOptional } from '@nestjs/swagger';
import { IsOptional, IsString } from 'class-validator';

export class CreateSandboxDto {
  @ApiPropertyOptional({
    description: 'Custom sandbox ID. If not provided, a UUID will be generated.',
    example: 'my-sandbox-1',
  })
  @IsOptional()
  @IsString()
  sandboxId?: string;
}
```

```typescript
// src/sandbox/dto/update-sandbox.dto.ts
import { ApiPropertyOptional } from '@nestjs/swagger';
import { IsOptional, IsObject } from 'class-validator';

// IMPORTANT: Do NOT use @ValidateNested() + @Type(() => EntityOperationsDto) on
// Record<string, EntityOperationsDto>. class-transformer treats the Record itself
// as the DTO (checking keys like entity type names against DTO properties) rather than
// validating each value. This causes "property {entityType} should not exist" errors.
//
// Instead, all operation-level validation is done in SandboxService.updateSandbox():
//   - Unknown entity types → BadRequestException
//   - Unknown operation keys (not add/update/remove) → BadRequestException
//   - Entity shape validation on add → BadRequestException
//   - Uniqueness constraints on add → ConflictException

export class UpdateSandboxDto {
  @ApiPropertyOptional({
    description:
      'Entity operations by entity type. Each type supports add (array of new entities), update (map of primaryKey -> partial updates), and remove (array of primary keys to delete). Entity type names match the dynamically discovered types.',
    example: {
      entityTypeA: {
        add: [
          {
            primaryKeyField: '999',
            name: 'New Entity',
            naturalKey: '111222333',
          },
        ],
        update: { 'existingKey': { name: 'Updated Name' } },
        remove: [],
      },
    },
  })
  @IsOptional()
  @IsObject()
  entities?: Record<string, any>;
}
```
</sandbox_dtos_template>
