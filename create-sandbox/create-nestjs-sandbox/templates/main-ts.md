<main_ts_template>
```typescript
import { NestFactory } from '@nestjs/core';
import { SwaggerModule, DocumentBuilder } from '@nestjs/swagger';
import { ValidationPipe } from '@nestjs/common';
import { AppModule } from './app.module';

async function bootstrap() {
  const app = await NestFactory.create(AppModule);

  app.enableCors();
  app.useGlobalPipes(
    new ValidationPipe({
      transform: true,
      whitelist: true,
      forbidNonWhitelisted: true,
    }),
  );

  const config = new DocumentBuilder()
    .setTitle('{{API_TITLE}}')
    .setDescription('Sandbox API service with in-memory data for testing. Create sandboxes, then call controller endpoints within a sandbox context.')
    .setVersion('1.0.0')
    .addTag('sandboxes', 'Sandbox lifecycle management')
    {{CONTROLLER_TAGS}}
    .build();

  const document = SwaggerModule.createDocument(app, config);
  SwaggerModule.setup('api', app, document);

  const port = process.env.PORT || 3000;
  await app.listen(port);
  console.log(`Sandbox API running on http://localhost:${port}`);
  console.log(`Swagger UI available at http://localhost:${port}/api`);
}
bootstrap();
```

**Placeholders:**
- `{{API_TITLE}}` - Replace with a descriptive title based on the API source (e.g., "MyNBG Sandbox API")
- `{{CONTROLLER_TAGS}}` - Replace with `.addTag('controller-name', 'Controller description')` for each identified controller
</main_ts_template>

<app_module_template>
```typescript
import { Module } from '@nestjs/common';
import { SandboxModule } from './sandbox/sandbox.module';
{{CONTROLLER_IMPORTS}}

@Module({
  imports: [
    SandboxModule,
    {{CONTROLLER_MODULES}}
  ],
})
export class AppModule {}
```

**Placeholders:**
- `{{CONTROLLER_IMPORTS}}` - Import statements for each controller module
- `{{CONTROLLER_MODULES}}` - Module class names in the imports array
</app_module_template>
