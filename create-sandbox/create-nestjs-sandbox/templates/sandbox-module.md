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
import { Injectable, NotFoundException } from '@nestjs/common';
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
      for (const [entityType, operations] of Object.entries(updateDto.entities)) {
        const collection = sandbox.entities[entityType];
        if (!collection) continue;

        // Add new entities
        if (operations.add) {
          for (const entity of operations.add) {
            const primaryKey = this.getPrimaryKey(entityType, entity);
            collection.set(primaryKey, entity);
          }
        }

        // Update existing entities (partial merge)
        if (operations.update) {
          for (const [key, updates] of Object.entries(operations.update)) {
            const existing = collection.get(key);
            if (existing) {
              collection.set(key, { ...existing, ...updates });
            }
          }
        }

        // Remove entities
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

  // {{PRIMARY_KEY_MAP}}
  // Map entity types to their primary key field names.
  // Generated from the identified entities during parsing.
  private getPrimaryKey(entityType: string, entity: any): string {
    const keyMap: Record<string, string> = {
      // e.g.: customers: 'customerCode', cards: 'cardNumber', accounts: 'account'
    };
    const keyField = keyMap[entityType];
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
- `{{PRIMARY_KEY_MAP}}` - Replace the empty `keyMap` object with mappings from entity type names to their primary key field names.
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

export class EntityOperationsDto {
  add?: any[];
  update?: Record<string, any>;
  remove?: string[];
}

export class UpdateSandboxDto {
  @ApiPropertyOptional({
    description: 'Entity operations by entity type. Each type supports add (array of new entities), update (map of primaryKey -> partial updates), and remove (array of primary keys to delete).',
    example: {
      customers: {
        add: [{ customerCode: '999', name: 'New Customer', taxNo: '111222333' }],
        update: { '1317952138': { name: 'Updated Name' } },
        remove: [],
      },
    },
  })
  @IsOptional()
  @IsObject()
  entities?: Record<string, EntityOperationsDto>;
}
```
</sandbox_dtos_template>
