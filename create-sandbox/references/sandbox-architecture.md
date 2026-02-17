<architecture_overview>
The generated NestJS sandbox service follows a modular architecture with sandbox lifecycle management and controller-specific modules for each API group identified from the input data.
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
│   │   │   └── sandbox-store.interface.ts # In-memory store interface
│   │   └── decorators/
│   │       └── sandbox-id.decorator.ts  # Extract sandboxId from header/param
│   ├── sandbox/
│   │   ├── sandbox.module.ts
│   │   ├── sandbox.controller.ts        # CRUD for sandbox lifecycle
│   │   ├── sandbox.service.ts           # Sandbox management logic
│   │   └── dto/
│   │       ├── create-sandbox.dto.ts
│   │       ├── update-sandbox.dto.ts
│   │       └── sandbox-response.dto.ts
│   └── controllers/
│       ├── {controller-name}/           # One per identified controller
│       │   ├── {controller}.module.ts
│       │   ├── {controller}.controller.ts
│       │   ├── {controller}.service.ts
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

<sandbox_service_pattern>
The SandboxService manages the in-memory store for all sandboxes:

```typescript
// Pattern for SandboxService
@Injectable()
export class SandboxService {
  // Map of sandboxId -> controller -> endpoint -> data
  private sandboxes: Map<string, SandboxData> = new Map();

  createSandbox(createDto: CreateSandboxDto): SandboxResponseDto {
    const sandboxId = createDto.sandboxId || uuidv4();
    // Initialize with seed data from all controllers
    this.sandboxes.set(sandboxId, this.generateSeedData());
    return { sandboxId, controllers: [...this.sandboxes.get(sandboxId).keys()] };
  }

  getSandbox(sandboxId: string): SandboxData {
    if (!this.sandboxes.has(sandboxId)) {
      throw new NotFoundException(`Sandbox ${sandboxId} not found`);
    }
    return this.sandboxes.get(sandboxId);
  }

  updateSandbox(sandboxId: string, updateDto: UpdateSandboxDto): SandboxResponseDto {
    // Update specific controller data or endpoint configurations
  }

  deleteSandbox(sandboxId: string): void {
    if (!this.sandboxes.delete(sandboxId)) {
      throw new NotFoundException(`Sandbox ${sandboxId} not found`);
    }
  }

  // Controller services call this to get/set data for their endpoints
  getControllerData(sandboxId: string, controller: string): any {
    const sandbox = this.getSandbox(sandboxId);
    return sandbox[controller];
  }
}
```
</sandbox_service_pattern>

<sandbox_data_structure>
```typescript
// The in-memory data structure
interface SandboxData {
  [controller: string]: ControllerData;
}

interface ControllerData {
  [endpoint: string]: EndpointData;
}

interface EndpointData {
  seedResponse: any;           // The original sample response
  customResponses: any[];      // User-added response variations
  requestSchema: any;          // Expected request structure
}
```
</sandbox_data_structure>

<controller_pattern>
Each controller follows this pattern:

```typescript
@ApiTags('{controller-name}')
@Controller('sandbox/:sandboxId/{controller-path}')
export class ResourceController {
  constructor(
    private readonly resourceService: ResourceService,
    private readonly sandboxService: SandboxService,
  ) {}

  @Post('{action-path}')
  @ApiOperation({ summary: '{Action description}' })
  async actionName(
    @Param('sandboxId') sandboxId: string,
    @Body() requestDto: ActionRequestDto,
  ): Promise<ActionResponseDto> {
    return this.resourceService.handleAction(sandboxId, requestDto);
  }
}
```

**Key points:**
- All controller endpoints are prefixed with `/sandbox/:sandboxId/`
- The sandboxId param identifies which sandbox's data to use
- The controller service retrieves data from the SandboxService
- Request/response DTOs match the original API structure
</controller_pattern>

<controller_service_pattern>
```typescript
@Injectable()
export class ResourceService {
  constructor(private readonly sandboxService: SandboxService) {}

  async handleAction(sandboxId: string, requestDto: any): Promise<any> {
    const controllerData = this.sandboxService.getControllerData(sandboxId, 'controller-name');
    const endpointData = controllerData['actionName'];

    // Return the seed response, optionally filtered by request params
    return {
      payload: endpointData.seedResponse.payload,
      exception: null,
      messages: null,
      executionTime: 0.0,
    };
  }
}
```
</controller_service_pattern>

<sandbox_controller_endpoints>
```
POST   /sandboxes                              → Create new sandbox with seed data
GET    /sandboxes/:sandboxId                   → Get sandbox configuration and data summary
PUT    /sandboxes/:sandboxId                   → Update sandbox data or endpoint configs
DELETE /sandboxes/:sandboxId                   → Delete sandbox and free memory

GET    /sandbox/:sandboxId/{controller}/{action}  → Controller-specific endpoints
POST   /sandbox/:sandboxId/{controller}/{action}  → Controller-specific endpoints
```
</sandbox_controller_endpoints>

<swagger_configuration>
The generated service includes full Swagger/OpenAPI documentation:

- **Title:** Generated from the API source (e.g., "NBG Sandbox API")
- **Version:** "1.0.0"
- **Description:** "Sandbox service with in-memory data for API testing"
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
