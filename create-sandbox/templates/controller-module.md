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
  // --- SEARCH ENDPOINT PATTERN ---
  // For endpoints that search/filter entities (e.g., customer search):
  //
  // async simpleSearch(sandboxId: string, requestDto: any): Promise<any> {
  //   // Query all entities of the relevant type
  //   let results = this.sandboxService.findEntities(
  //     sandboxId,
  //     'customers',     // entity type
  //     (customer: any) => {
  //       // Filter by request parameters
  //       if (requestDto.payload.taxNo && customer.taxNo !== requestDto.payload.taxNo) return false;
  //       if (requestDto.payload.account) {
  //         // Cross-entity lookup: check if customer has this account
  //         const accounts = this.sandboxService.findEntities(
  //           sandboxId, 'accounts',
  //           (a: any) => a.customerCode === customer.customerCode && a.account === requestDto.payload.account,
  //         );
  //         if (accounts.length === 0) return false;
  //       }
  //       return true;
  //     },
  //   );
  //
  //   return {
  //     payload: {
  //       items: results.map(c => this.toSearchItem(c)),
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
  // For endpoints that fetch a specific entity by ID (e.g., card details):
  //
  // async fetchCreditCardFullData(sandboxId: string, requestDto: any): Promise<any> {
  //   const { cardNumber } = requestDto.payload;
  //   const card = this.sandboxService.getEntity(sandboxId, 'cards', cardNumber);
  //
  //   if (!card) {
  //     return { payload: null, exception: { message: 'Card not found' }, executionTime: 0.0 };
  //   }
  //
  //   return {
  //     payload: this.toCardFullData(card),
  //     exception: null,
  //     executionTime: 0.0,
  //   };
  // }
  //
  // --- CROSS-ENTITY AGGREGATION PATTERN ---
  // For endpoints that aggregate data across entity types (e.g., customer products):
  //
  // async getCustomerProducts(sandboxId: string, requestDto: any): Promise<any> {
  //   const { customerCode } = requestDto.payload;
  //
  //   // Find all accounts belonging to this customer
  //   const accounts = this.sandboxService.findEntities(
  //     sandboxId, 'accounts', (a: any) => a.customerCode === customerCode,
  //   );
  //
  //   // Find all cards belonging to this customer
  //   const cards = this.sandboxService.findEntities(
  //     sandboxId, 'cards', (c: any) => c.customerCode === customerCode,
  //   );
  //
  //   return {
  //     payload: {
  //       productGroups: this.buildProductGroups(accounts, cards),
  //       // ... other response fields
  //     },
  //     exception: null,
  //     messages: null,
  //     executionTime: 0.0,
  //   };
  // }
  //
  // --- RESPONSE MAPPER METHODS ---
  // Private methods that map entity fields to the API response format.
  // These preserve the exact response structure from the original sample data.
  //
  // private toSearchItem(customer: any): any {
  //   return {
  //     customerCode: customer.customerCode,
  //     name: customer.name,
  //     // ... map all fields matching the original response format
  //   };
  // }
}
```

**Response builder rules:**
1. **Request parameters drive behavior** - Extract filter/lookup values from `requestDto.payload`
2. **Entity queries** - Use `sandboxService.findEntities()` for searches, `sandboxService.getEntity()` for lookups
3. **Cross-entity joins** - Use `findEntities()` with predicates that reference other entity types
4. **Exact response format** - The returned JSON must match the original API response structure exactly (field names, nesting, envelope)
5. **Computed fields** - `total`, `listCount`, `moreData`, `executionTime` are computed at response time from the query results
6. **Graceful missing data** - Return empty arrays/null fields for missing entities, not HTTP errors (unless the original API returns errors for missing data)
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
