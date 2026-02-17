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
// import { {{Action}}ResponseDto } from './dto/{{action}}-response.dto';

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
  // @ApiResponse({ status: 200, type: {{Action}}ResponseDto })
  // async {{actionName}}(
  //   @Param('sandboxId') sandboxId: string,
  //   @Body() requestDto: {{Action}}RequestDto,
  // ): Promise<{{Action}}ResponseDto> {
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
```typescript
// src/controllers/{{controller}}/{{controller}}.service.ts
import { Injectable } from '@nestjs/common';
import { SandboxService } from '../../sandbox/sandbox.service';

@Injectable()
export class {{Controller}}Service {
  constructor(private readonly sandboxService: SandboxService) {}

  // Generate one method per action:
  //
  // async {{actionName}}(sandboxId: string, requestDto: any): Promise<any> {
  //   return this.sandboxService.getEndpointData(
  //     sandboxId,
  //     '{{controller}}',
  //     '{{actionName}}',
  //   );
  // }
}
```

**Notes:**
- Each action method simply retrieves the seed data for that endpoint from the SandboxService
- The controller name and action name are used as keys to look up the data
- The return type wraps the response in the standard API response envelope
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

```typescript
// src/controllers/{{controller}}/dto/{{action}}-response.dto.ts
// Same pattern as request DTO, but reflecting the response payload structure.
// Include nested DTOs for complex objects.
// Use arrays where the response contains lists.
//
// export class {{Action}}ResponseDto {
//   @ApiProperty({ type: [ItemDto] })
//   @IsArray()
//   @ValidateNested({ each: true })
//   @Type(() => ItemDto)
//   items: ItemDto[];
//
//   @ApiProperty()
//   @IsBoolean()
//   moreData: boolean;
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
