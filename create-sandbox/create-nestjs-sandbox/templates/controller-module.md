<controller_module_template>
For each identified controller, generate these files following this pattern.

Replace `{{Controller}}` with PascalCase controller name (e.g., `Cards`), `{{controller}}` with kebab-case (e.g., `cards`), and `{{controllerPath}}` with the URL path segments from the original API.

```typescript
// src/controllers/{{controller}}/{{controller}}.module.ts
import { Module } from '@nestjs/common';
import { {{Controller}}Controller } from './{{controller}}.controller';
import { {{Controller}}Service } from './{{controller}}.service';

@Module({
  controllers: [{{Controller}}Controller],
  providers: [{{Controller}}Service],
})
export class {{Controller}}Module {}
```
</controller_module_template>

<controller_endpoint_template>
```typescript
// src/controllers/{{controller}}/{{controller}}.controller.ts
import { Controller, Post, Param, Body } from '@nestjs/common';
import { ApiTags, ApiOperation, ApiParam, ApiBody, ApiResponse } from '@nestjs/swagger';
import { {{Controller}}Service } from './{{controller}}.service';
// Import DTOs for each endpoint action:
// import { {{Action}}RequestDto } from './dto/{{action}}-request.dto';

@ApiTags('{{controller}}')
@Controller('sandbox/:sandboxId/{{controllerPath}}')
export class {{Controller}}Controller {
  constructor(private readonly {{controller}}Service: {{Controller}}Service) {}

  // Generate one endpoint per action identified in the parsed data:
  //
  // @Post('{{actionPath}}')
  // @ApiOperation({ summary: '{{Action description from original URL}}' })
  // @ApiParam({ name: 'sandboxId', description: 'Sandbox identifier' })
  // @ApiBody({ type: {{Action}}RequestDto })
  // @ApiResponse({ status: 200, description: '{{Action}} response' })
  // async {{actionName}}(
  //   @Param('sandboxId') sandboxId: string,
  //   @Body() requestDto: {{Action}}RequestDto,
  // ): Promise<any> {
  //   return this.{{controller}}Service.{{actionName}}(sandboxId, requestDto);
  // }
}
```

**Notes:**
- Use `@Post()` for endpoints that match POST requests in the original API
- The `{{controllerPath}}` comes from the URL path segments (the controller segment from the `{api}/{controller}/{action}` pattern)
- Each action method delegates to the service
</controller_endpoint_template>

<controller_service_template>
Controller services query the entity store and build API responses dynamically.
Entity type names used in queries match whatever was discovered from the API data.

```typescript
// src/controllers/{{controller}}/{{controller}}.service.ts
import { Injectable } from '@nestjs/common';
import { SandboxService } from '../../sandbox/sandbox.service';

@Injectable()
export class {{Controller}}Service {
  constructor(private readonly sandboxService: SandboxService) {}

  // Generate one method per action. Each method:
  // 1. Extracts lookup/filter parameters from the request DTO
  // 2. Queries the entity store using SandboxService methods
  // 3. Filters/transforms entities based on request parameters
  // 4. Constructs the API response in the exact format of the original sample response
  //
  // --- SEARCH ENDPOINT PATTERN (uses metadata for ownership checks) ---
  // For endpoints that search/filter entities:
  //
  // async searchAction(sandboxId: string, requestDto: any): Promise<any> {
  //   const metadata = this.sandboxService.getMetadata(sandboxId);
  //   const { filterField, relatedEntityKey } = requestDto.payload;
  //
  //   const results = this.sandboxService.findEntities(sandboxId, 'discoveredEntityType',
  //     (entity: any) => {
  //       if (!filterField || entity.filterField !== filterField) return false;
  //       // Use metadata for cross-entity ownership check
  //       if (relatedEntityKey) {
  //         const relations = metadata.parentChildRelations.get(entity.rootEntityKey) || {};
  //         const childKeys = relations['relatedType'] || [];
  //         if (!childKeys.includes(relatedEntityKey)) return false;
  //       }
  //       return true;
  //     },
  //   );
  //
  //   return {
  //     payload: {
  //       items: results.map(e => this.toSearchItem(e)),
  //       moreData: false,
  //       tokenType: null,
  //     },
  //     exception: null,
  //     messages: null,
  //     executionTime: 0.0,
  //   };
  // }
  //
  // --- SINGLE ENTITY LOOKUP PATTERN ---
  // For endpoints that fetch a specific entity by ID:
  //
  // async lookupAction(sandboxId: string, requestDto: any): Promise<any> {
  //   const { entityKey } = requestDto.payload;
  //   const entity = this.sandboxService.getEntity(sandboxId, 'discoveredEntityType', entityKey);
  //
  //   if (!entity) {
  //     return { payload: null, exception: { message: 'Not found' }, executionTime: 0.0 };
  //   }
  //
  //   return {
  //     payload: this.toDetailResponse(entity),
  //     exception: null,
  //     executionTime: 0.0,
  //   };
  // }
  //
  // --- CROSS-ENTITY AGGREGATION PATTERN (METADATA-DRIVEN) ---
  // For endpoints that aggregate data across entity types:
  // Uses dynamic metadata structures instead of hardcoded entity type references.
  //
  // async aggregateAction(sandboxId: string, requestDto: any): Promise<any> {
  //   const entities = this.sandboxService.getEntities(sandboxId);
  //   const metadata = this.sandboxService.getMetadata(sandboxId);
  //   const { rootEntityKey, skipChildType } = requestDto.payload;
  //
  //   // Use parentChildRelations to find child entity keys dynamically
  //   const relations = metadata.parentChildRelations.get(rootEntityKey) || {};
  //
  //   // Build product groups dynamically based on discovered child types
  //   const productGroups = [];
  //   for (const [childType, childKeys] of Object.entries(relations)) {
  //     // Support request-driven filtering (e.g., skip certain child types)
  //     if (skipChildType === childType) continue;
  //
  //     const childEntities = childKeys
  //       .map(k => (entities[childType] as Map<string, any>)?.get(k))
  //       .filter(Boolean);
  //
  //     // Use typeGroupings for this child type if available
  //     const typeMap = metadata.typeGroupings[childType];
  //     // Use preComputedViews if available
  //     const viewMap = metadata.preComputedViews[childType + 'Positions'];
  //
  //     // Group entities by type and build product group response
  //     // ...
  //   }
  //
  //   return {
  //     payload: { productGroups },
  //     exception: null,
  //     messages: null,
  //     executionTime: 0.0,
  //   };
  // }
  //
  // --- DATE RANGE FILTERING PATTERN ---
  // For endpoints that filter by date range:
  //
  // async listByDateAction(sandboxId: string, requestDto: any): Promise<any> {
  //   const { parentKey, dateFrom, dateTo } = requestDto.payload;
  //   let results = this.sandboxService.findEntities(sandboxId, 'childEntityType',
  //     (entity: any) => entity.parentKey === parentKey,
  //   );
  //   if (dateFrom) results = results.filter(e => e.transactionDate >= dateFrom);
  //   if (dateTo) results = results.filter(e => e.transactionDate <= dateTo);
  //   // ... build response
  // }
  //
  // --- RELATED ENTITY LOOKUP PATTERN ---
  // When filtering by a key, also check related entity fields:
  //
  // async relatedLookupAction(sandboxId: string, requestDto: any): Promise<any> {
  //   const { lookupKey, dateFrom, dateTo } = requestDto.payload;
  //   const parentEntity = this.sandboxService.getEntity(sandboxId, 'parentType', lookupKey);
  //   const relatedKey = parentEntity?.relatedEntityKey;
  //   let results = this.sandboxService.findEntities(sandboxId, 'childType',
  //     (child: any) => child.parentKey === lookupKey ||
  //       (relatedKey && child.parentKey === relatedKey),
  //   );
  //   // ... optional date filtering, build response
  // }
  //
  // --- RESPONSE MAPPER METHODS ---
  // Private methods that map entity fields to the API response format.
  // These preserve the exact response structure from the original sample data.
  //
  // DEFAULT FALLBACK PATTERN: Use ?? for fields that may not exist on all entities:
  // private toDetailResponse(entity: any): any {
  //   return {
  //     primaryKey: entity.primaryKey,
  //     status: entity.status ?? '00',
  //     name: entity.name ?? '',
  //     hasFullData: entity.hasFullData ?? false,
  //   };
  // }
  //
  // CONDITIONAL FIELD INCLUSION: Only include optional fields when they have values:
  // private toTransactionItem(item: any): any {
  //   const result: any = { id: item.id, amount: item.amount };
  //   if (item.currency !== undefined) result.currency = item.currency;
  //   if (item.regionCode) result.regionCode = item.regionCode;
  //   return result;
  // }
  //
  // TYPE CONVERSION: Convert entity types to match API response format:
  // private toSearchItem(entity: any): any {
  //   return {
  //     entityCode: parseFloat(entity.entityCode),  // string → number
  //     name: entity.name,
  //   };
  // }
}
```

**Response builder rules:**
1. **Request parameters drive behavior** - Extract filter/lookup values from `requestDto.payload`
2. **Entity queries** - Use `sandboxService.findEntities()` for searches, `sandboxService.getEntity()` for lookups
3. **Metadata-driven aggregation** - Use `sandboxService.getMetadata()` for cross-entity lookups via `parentChildRelations`, type grouping via `typeGroupings`, and pre-computed views via `preComputedViews`
4. **Exact response format** - The returned JSON must match the original API response structure exactly (field names, nesting, envelope)
5. **Computed fields** - `total`, `listCount`, `moreData`, `executionTime` are computed at response time from the query results
6. **Graceful missing data** - Return empty arrays/null fields for missing entities, not HTTP errors (unless the original API returns errors for missing data)
7. **Response mapper patterns** - Use `?? defaultValue` for fallbacks, conditional field inclusion for optional fields, `parseFloat()` for type conversions
8. **Date range filtering** - Filter entities by comparing date strings from request parameters
</controller_service_template>

<controller_dto_template>
For each endpoint action, generate request and response DTOs from the parsed JSON structures:

```typescript
// src/controllers/{{controller}}/dto/{{action}}-request.dto.ts
import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { IsString, IsNumber, IsBoolean, IsOptional, IsArray, ValidateNested } from 'class-validator';
import { Type } from 'class-transformer';

// Generate DTO class with properties matching the request payload structure:
//
// export class {{Action}}RequestDto {
//   @ApiProperty({ description: '...', example: '...' })
//   @IsString()
//   fieldName: string;
//
//   @ApiPropertyOptional({ description: '...' })
//   @IsOptional()
//   @IsNumber()
//   optionalField?: number;
//
//   @ApiProperty({ type: NestedDto })
//   @ValidateNested()
//   @Type(() => NestedDto)
//   nestedField: NestedDto;
// }
```

**DTO generation rules:**
1. Every field from the sample JSON becomes a DTO property
2. Use `@ApiProperty()` with `example` values from the sample data
3. Use `@ApiPropertyOptional()` for fields that are `null` in the sample
4. Create separate DTO classes for nested objects
5. Use `@Type(() => NestedDto)` for class-transformer to handle nested objects
6. Use the exact field names from the API response (preserve casing)
</controller_dto_template>
