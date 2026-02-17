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

<sandbox_service_template>
```typescript
// src/sandbox/sandbox.service.ts
import { Injectable, NotFoundException } from '@nestjs/common';
import { v4 as uuidv4 } from 'uuid';
import { CreateSandboxDto } from './dto/create-sandbox.dto';
import { UpdateSandboxDto } from './dto/update-sandbox.dto';

export interface EndpointData {
  seedResponse: any;
  requestSchema: Record<string, any>;
}

export interface ControllerData {
  [endpoint: string]: EndpointData;
}

export interface SandboxData {
  sandboxId: string;
  createdAt: Date;
  controllers: Record<string, ControllerData>;
}

@Injectable()
export class SandboxService {
  private sandboxes: Map<string, SandboxData> = new Map();

  createSandbox(createDto: CreateSandboxDto): SandboxData {
    const sandboxId = createDto.sandboxId || uuidv4();

    if (this.sandboxes.has(sandboxId)) {
      throw new Error(`Sandbox ${sandboxId} already exists`);
    }

    const sandboxData: SandboxData = {
      sandboxId,
      createdAt: new Date(),
      controllers: this.generateSeedData(),
    };

    this.sandboxes.set(sandboxId, sandboxData);
    return sandboxData;
  }

  getSandbox(sandboxId: string): SandboxData {
    const sandbox = this.sandboxes.get(sandboxId);
    if (!sandbox) {
      throw new NotFoundException(`Sandbox ${sandboxId} not found`);
    }
    return sandbox;
  }

  updateSandbox(sandboxId: string, updateDto: UpdateSandboxDto): SandboxData {
    const sandbox = this.getSandbox(sandboxId);

    if (updateDto.controllers) {
      for (const [controller, controllerData] of Object.entries(updateDto.controllers)) {
        if (!sandbox.controllers[controller]) {
          sandbox.controllers[controller] = {};
        }
        for (const [endpoint, endpointData] of Object.entries(controllerData)) {
          sandbox.controllers[controller][endpoint] = endpointData as EndpointData;
        }
      }
    }

    return sandbox;
  }

  deleteSandbox(sandboxId: string): void {
    if (!this.sandboxes.delete(sandboxId)) {
      throw new NotFoundException(`Sandbox ${sandboxId} not found`);
    }
  }

  getControllerData(sandboxId: string, controller: string): ControllerData {
    const sandbox = this.getSandbox(sandboxId);
    return sandbox.controllers[controller] || {};
  }

  getEndpointData(sandboxId: string, controller: string, endpoint: string): any {
    const controllerData = this.getControllerData(sandboxId, controller);
    const endpointData = controllerData[endpoint];
    if (!endpointData) {
      throw new NotFoundException(
        `Endpoint ${endpoint} not found in controller ${controller}`,
      );
    }
    return endpointData.seedResponse;
  }

  listSandboxes(): SandboxData[] {
    return Array.from(this.sandboxes.values());
  }

  private generateSeedData(): Record<string, ControllerData> {
    // {{SEED_DATA_BLOCK}}
    // This method will be populated with actual seed data
    // from the parsed API responses during generation.
    // Each controller maps to its endpoints, each endpoint
    // maps to { seedResponse, requestSchema }
    return {};
  }
}
```

**Placeholder:**
- `{{SEED_DATA_BLOCK}}` - Replace the `return {}` with the actual seed data object built from the parsed API responses. Structure:
```typescript
return {
  'controller-name': {
    'actionName': {
      seedResponse: { /* actual parsed response JSON */ },
      requestSchema: { /* actual parsed request payload structure */ },
    },
    // more endpoints...
  },
  // more controllers...
};
```
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
import { SandboxService, SandboxData } from './sandbox.service';
import { CreateSandboxDto } from './dto/create-sandbox.dto';
import { UpdateSandboxDto } from './dto/update-sandbox.dto';

@ApiTags('sandboxes')
@Controller('sandboxes')
export class SandboxController {
  constructor(private readonly sandboxService: SandboxService) {}

  @Post()
  @ApiOperation({ summary: 'Create a new sandbox with seed data' })
  @ApiBody({ type: CreateSandboxDto })
  @ApiResponse({ status: 201, description: 'Sandbox created successfully' })
  create(@Body() createDto: CreateSandboxDto): SandboxData {
    return this.sandboxService.createSandbox(createDto);
  }

  @Get()
  @ApiOperation({ summary: 'List all sandboxes' })
  @ApiResponse({ status: 200, description: 'List of all sandboxes' })
  findAll(): SandboxData[] {
    return this.sandboxService.listSandboxes();
  }

  @Get(':sandboxId')
  @ApiOperation({ summary: 'Get sandbox configuration and data models' })
  @ApiParam({ name: 'sandboxId', description: 'The sandbox identifier' })
  @ApiResponse({ status: 200, description: 'Sandbox data' })
  @ApiResponse({ status: 404, description: 'Sandbox not found' })
  findOne(@Param('sandboxId') sandboxId: string): SandboxData {
    return this.sandboxService.getSandbox(sandboxId);
  }

  @Put(':sandboxId')
  @ApiOperation({ summary: 'Update sandbox endpoints or data models' })
  @ApiParam({ name: 'sandboxId', description: 'The sandbox identifier' })
  @ApiBody({ type: UpdateSandboxDto })
  @ApiResponse({ status: 200, description: 'Sandbox updated' })
  @ApiResponse({ status: 404, description: 'Sandbox not found' })
  update(
    @Param('sandboxId') sandboxId: string,
    @Body() updateDto: UpdateSandboxDto,
  ): SandboxData {
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

export class UpdateSandboxDto {
  @ApiPropertyOptional({
    description: 'Controller data to add or update. Keys are controller names, values are endpoint data maps.',
    example: { cards: { fetchDetails: { seedResponse: {}, requestSchema: {} } } },
  })
  @IsOptional()
  @IsObject()
  controllers?: Record<string, Record<string, any>>;
}
```
</sandbox_dtos_template>
