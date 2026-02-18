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
export interface EntityStore {
  [entityType: string]: Map<string, any>;
  // Generated entity Maps go here, e.g.:
  // customers: Map<string, CustomerEntity>;
  // cards: Map<string, CardEntity>;
  // accounts: Map<string, AccountEntity>;
}

export interface SandboxData {
  sandboxId: string;
  createdAt: Date;
  entities: EntityStore;
}

// JSON-serializable versions (Map → Record) for API responses.
// Map objects serialize to {} with JSON.stringify, so all API
// return types must use these instead of the Map-based versions.
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
// Generate one interface per identified entity type.
// Each interface has:
// - A primary key field (used as the Map key)
// - Foreign key fields linking to parent entities
// - All data fields merged from every API response containing this entity
//
// Example:
//
// export interface CustomerEntity {
//   customerCode: string;       // Primary key
//   name: string;
//   taxNo: string;
//   branch: { code: string; name: string; /* ... */ };
//   type: string;
//   activityStatus: string;
//   // ... all fields from customer search response items
// }
//
// export interface CardEntity {
//   cardNumber: string;         // Primary key
//   customerCode: string;       // Foreign key → CustomerEntity
//   cardStatus: string;
//   cardStatusDescription: string;
//   productName: string;
//   productCode: string;
//   expirationDate: string;
//   // ... merged fields from fetchCreditCardFullData, fetchDetails, position subProducts
//   limits?: { /* ... */ };
//   security?: { /* ... */ };
//   availableActions?: Record<string, string>;
// }
//
// export interface AccountEntity {
//   account: string;            // Primary key
//   customerCode: string;       // Foreign key → CustomerEntity
//   description: string;
//   currency: { code: string | null; name: string };
//   amount: string;
//   branch: string;
//   // ... all fields from position product sub-products
// }
```

**Entity interface generation rules:**
1. Primary key field is always `string` type (convert numbers to strings)
2. Foreign key fields reference another entity's primary key
3. Merge fields from all API responses that contain this entity's data
4. Use optional (`?`) for fields that only appear in some responses
5. Preserve exact field names and nesting from the original API data
6. Nested objects (like `limits`, `security`, `branch`) become inline type definitions or separate interfaces
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
} from '../common/interfaces/sandbox-store.interface';
import { CreateSandboxDto } from './dto/create-sandbox.dto';
import { UpdateSandboxDto } from './dto/update-sandbox.dto';

@Injectable()
export class SandboxService {
  private sandboxes: Map<string, SandboxData> = new Map();

  // {{UNIQUE_FIELDS_MAP}}
  // Maps entity types to fields that must be unique within the collection.
  // Used by validateUniqueFields() to prevent duplicate entries.
  private readonly uniqueFieldsMap: Record<string, string[]> = {
    // e.g.: customers: ['taxNo', 'customerCode'], accounts: ['account'], cards: ['cardNumber']
  };

  // {{PRIMARY_KEY_MAP}}
  // Maps entity type names to their primary key field names.
  private readonly primaryKeyMap: Record<string, string> = {
    // e.g.: customers: 'customerCode', cards: 'cardNumber', accounts: 'account'
  };

  // {{ENTITY_SCHEMAS}}
  // Maps each entity type to its required fields and their typeof types.
  // Used by validateEntityShape() to check entities on add operations.
  // Derive from the entity interfaces in entities.interface.ts.
  private readonly entitySchemas: Record<string, Record<string, string>> = {
    // e.g.:
    // customers: {
    //   customerCode: 'string', name: 'string', taxNo: 'string',
    //   branch: 'object', type: 'string', activityStatus: 'string',
    //   // ... all required (non-optional) fields
    // },
    // accounts: {
    //   account: 'string', accountNoCD: 'string', branch: 'string',
    //   currency: 'object', amount: 'string',
    //   // ...
    // },
    // cards: {
    //   cardNumber: 'string',
    // },
  };

  // --- Public API methods (return SerializedSandboxData for JSON-safe responses) ---

  createSandbox(createDto: CreateSandboxDto): SerializedSandboxData {
    const sandboxId = createDto.sandboxId || uuidv4();

    if (this.sandboxes.has(sandboxId)) {
      throw new Error(`Sandbox ${sandboxId} already exists`);
    }

    const sandboxData: SandboxData = {
      sandboxId,
      createdAt: new Date(),
      entities: this.generateSeedEntities(),
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

  private generateSeedEntities(): EntityStore {
    // {{SEED_ENTITIES_BLOCK}}
    // Extract entity instances from the parsed API sample responses.
    // Each entity type is populated as a Map<primaryKey, entityData>.
    //
    // Example:
    // const customers = new Map<string, any>();
    // customers.set('1317952138', { customerCode: '1317952138', name: '...', taxNo: '140700917', ... });
    //
    // const cards = new Map<string, any>();
    // cards.set('5278900043068407', { cardNumber: '5278900043068407', customerCode: '1317952138', ... });
    //
    // const accounts = new Map<string, any>();
    // accounts.set('81751218256', { account: '81751218256', customerCode: '1317952138', ... });
    //
    // return { customers, cards, accounts };

    return {};
  }
}
```

**Placeholders:**
- `{{SEED_ENTITIES_BLOCK}}` - Replace `return {}` with entity Maps populated from parsed API responses. Each entity's fields are extracted and merged from all endpoints where that entity appears.
- `{{PRIMARY_KEY_MAP}}` - Replace the empty `primaryKeyMap` object with mappings from entity type names to their primary key field names.
- `{{UNIQUE_FIELDS_MAP}}` - Replace the empty `uniqueFieldsMap` object with entity types mapped to their unique field names (typically includes primary key and any natural keys like `taxNo`).
- `{{ENTITY_SCHEMAS}}` - Replace the empty `entitySchemas` object with required fields per entity type, derived from entity interfaces. Each field maps to its `typeof` type (`'string'`, `'number'`, `'boolean'`, `'object'`).
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
// as the DTO (checking keys like "customers" against DTO properties) rather than
// validating each value. This causes "property customers should not exist" errors.
//
// Instead, all operation-level validation is done in SandboxService.updateSandbox():
//   - Unknown entity types → BadRequestException
//   - Unknown operation keys (not add/update/remove) → BadRequestException
//   - Entity shape validation on add → BadRequestException
//   - Uniqueness constraints on add → ConflictException

export class UpdateSandboxDto {
  @ApiPropertyOptional({
    description:
      'Entity operations by entity type. Each type supports add (array of new entities), update (map of primaryKey -> partial updates), and remove (array of primary keys to delete).',
    example: {
      customers: {
        add: [
          {
            customerCode: '999',
            name: 'New Customer',
            taxNo: '111222333',
          },
        ],
        update: { '1317952138': { name: 'Updated Name' } },
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
