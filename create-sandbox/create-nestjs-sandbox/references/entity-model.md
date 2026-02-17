<entity_model_overview>
The entity-based data model replaces static per-endpoint responses with a normalized entity store. Instead of each endpoint returning a hardcoded response, entities (Customer, Card, Account, etc.) are stored independently and linked by relationships. Controller services query the entity store and dynamically construct API responses based on request parameters.

This enables realistic sandbox behavior:
- **Search** - Filter entities by field values (e.g., search customers by taxNo)
- **Lookups** - Retrieve specific entities by primary key (e.g., fetch card by cardNumber)
- **Cross-entity queries** - Follow relationships to build composite responses (e.g., get all products for a customer)
- **Multiple records** - Return different results based on different inputs
</entity_model_overview>

<entity_identification>
## How to Identify Entities from API Data

Analyze all parsed API responses and request payloads to identify domain entities.

### Step 1: Find Recurring Identifiers

Look for fields that appear across multiple endpoints as either:
- **Request parameters** (input) - fields used to look up data (e.g., `customerCode`, `cardNumber`, `taxNo`)
- **Response identifiers** (output) - fields that uniquely identify records in response data (e.g., `customerCode` in customer search results, `cardNumber` in card details)

A field that appears as an input parameter in one endpoint AND as an identifier in another endpoint's response is a strong signal of an entity.

### Step 2: Define Entity Types

For each recurring identifier, define an entity type:

```
Entity: {EntityName}
  Primary Key: {fieldName} (the unique identifier)
  Source Endpoints: {list of endpoints where this entity's data appears}
  Fields: {all fields from the richest response containing this entity}
```

### Step 3: Identify the Root Entity

The root entity is the one that:
- Other entities reference via foreign keys
- Is typically the first thing looked up in a workflow
- Has the broadest scope (e.g., a Customer has Cards, not the other way around)

Use `AskUserQuestion` to confirm the root entity with the user if there are multiple candidates.

### Step 4: Map Relationships

For each entity pair, determine:
- **One-to-many**: A customer has many cards (Customer.customerCode → Card.customerCode)
- **One-to-one**: A card has one set of limits (Card.cardNumber → CardLimits)
- **Ownership**: Which entity "owns" the other (parent → child)

Relationships are inferred from:
- Fields in one entity that match the primary key of another entity
- Nested structures in API responses (e.g., `productGroups[].customerSubProducts[]` suggests products belong to a customer)
- Request parameters that reference another entity (e.g., `fetchTransactions(cardNumber)` means transactions belong to a card)
</entity_identification>

<entity_store_design>
## Entity Store Structure

Replace the flat `controllers → endpoint → seedResponse` structure with a normalized entity store.

### Interface Design

```typescript
// src/common/interfaces/sandbox-store.interface.ts

// Each entity type gets its own interface
interface CustomerEntity {
  customerCode: string;       // Primary key
  name: string;
  taxNo: string;
  // ... all fields from the richest customer response
}

interface CardEntity {
  cardNumber: string;         // Primary key
  customerCode: string;       // Foreign key → CustomerEntity
  cardStatus: string;
  productName: string;
  // ... all fields from card responses
}

interface AccountEntity {
  account: string;            // Primary key
  customerCode: string;       // Foreign key → CustomerEntity
  description: string;
  // ... all fields from account/position responses
}

// The entity store holds all entities for a sandbox
interface EntityStore {
  customers: Map<string, CustomerEntity>;
  cards: Map<string, CardEntity>;
  accounts: Map<string, AccountEntity>;
  // Add Map for each identified entity type
}

// SandboxData now wraps the entity store
interface SandboxData {
  sandboxId: string;
  createdAt: Date;
  entities: EntityStore;
}
```

### Design Rules

1. **Primary key as Map key** - Each entity Map is keyed by the entity's primary key field
2. **Foreign keys as fields** - Related entities store the parent's primary key as a field
3. **Flat storage** - Avoid nesting entities inside each other in the store; keep them flat and linked by keys
4. **Rich entities** - Merge fields from ALL endpoints that return data for the same entity type into a single entity interface. The entity should be a superset of all response fields for that type.
5. **Derived data stays out** - Fields that are computed at response time (like `moreData`, `executionTime`, `listCount`) are NOT stored on entities; they are added by response builders.
</entity_store_design>

<entity_extraction>
## Extracting Entities from Seed Data

When generating the `generateSeedData()` method, extract entity instances from the provided API sample responses.

### Process

1. **Parse customer data** from customer-related responses → create `CustomerEntity` instances
2. **Parse card data** from card-related responses → create `CardEntity` instances, linking to customer via `customerCode`
3. **Parse account data** from position/product responses → create `AccountEntity` instances, linking to customer via `customerCode`
4. **Parse sub-entities** (transactions, limits, etc.) → either embed in parent entity or create separate entity Maps

### Example: Extracting from Sample Data

Given a customer search response:
```json
{ "payload": { "items": [{ "customerCode": 1317952138, "name": "...", "taxNo": "140700917", ... }] } }
```

Extract:
```typescript
customers.set('1317952138', {
  customerCode: '1317952138',
  name: '...',
  taxNo: '140700917',
  // ... all other fields from the item
});
```

Given a position/products response with card sub-products:
```json
{ "payload": { "productGroups": [{ "description": "ΚΑΡΤΕΣ", "customerSubProducts": [{ "account": "5278900043068407", ... }] }] } }
```

Extract:
```typescript
cards.set('5278900043068407', {
  cardNumber: '5278900043068407',
  customerCode: '1317952138',  // Link to the customer
  description: 'MC Classic',
  // ... fields from sub-product
});
```

### Merging Entity Data from Multiple Endpoints

The same entity (e.g., a card) may appear in multiple API responses with different fields. Merge all available fields into the entity:

- `position/getCustomerProducts` provides: `cardNumber`, `description`, `amount`, `availableBalance`, `productCode`
- `cards/fetchCreditCardFullData` provides: `cardNumber`, `cardStatus`, `limits`, `security`, `expirationDate`, `productName`
- `cards/fetchDetails` provides: `cardNumber`, `plasticStatus`, `availableActions`, `limits`, `security`

The `CardEntity` should contain ALL of these fields merged together.
</entity_extraction>

<response_builders>
## Response Builder Pattern

Controller services no longer return static seed responses. Instead, they query the entity store and construct API responses dynamically.

### Pattern

```typescript
@Injectable()
export class CustomerService {
  constructor(private readonly sandboxService: SandboxService) {}

  async simpleSearch(sandboxId: string, requestDto: SimpleSearchRequestDto): Promise<any> {
    const entities = this.sandboxService.getEntities(sandboxId);
    let customers = Array.from(entities.customers.values());

    // Filter by request parameters
    const { taxNo, account } = requestDto.payload;
    if (taxNo) {
      customers = customers.filter(c => c.taxNo === taxNo);
    }
    if (account) {
      customers = customers.filter(c => {
        // Check if customer has this account
        const customerAccounts = Array.from(entities.accounts.values())
          .filter(a => a.customerCode === c.customerCode);
        return customerAccounts.some(a => a.account === account);
      });
    }

    // Build response in API format
    return {
      payload: {
        items: customers.map(c => this.toSearchItem(c)),
        moreData: false,
        tokenType: null,
      },
      exception: null,
      messages: null,
      executionTime: 0.0,
    };
  }

  // Map entity to API response shape
  private toSearchItem(customer: CustomerEntity): any {
    return {
      customerCode: customer.customerCode,
      name: customer.name,
      taxNo: customer.taxNo,
      branch: customer.branch,
      // ... map all fields to match the original API response format
    };
  }
}
```

### Cross-Entity Response Building

For endpoints that combine data from multiple entity types:

```typescript
@Injectable()
export class PositionService {
  constructor(private readonly sandboxService: SandboxService) {}

  async getCustomerProducts(sandboxId: string, requestDto: any): Promise<any> {
    const entities = this.sandboxService.getEntities(sandboxId);
    const { customerCode } = requestDto.payload;

    // Find all accounts belonging to this customer
    const customerAccounts = Array.from(entities.accounts.values())
      .filter(a => a.customerCode === customerCode);

    // Find all cards belonging to this customer
    const customerCards = Array.from(entities.cards.values())
      .filter(c => c.customerCode === customerCode);

    // Build product groups from the entity data
    const productGroups = this.buildProductGroups(customerAccounts, customerCards);

    return {
      payload: { productGroups, /* ... */ },
      exception: null,
      messages: null,
      executionTime: 0.0,
    };
  }
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
  const sandbox = this.getSandbox(sandboxId);
  return sandbox.entities;
}

// Get all entities of a specific type
getEntityCollection<T>(sandboxId: string, entityType: keyof EntityStore): Map<string, T> {
  const entities = this.getEntities(sandboxId);
  return entities[entityType] as Map<string, T>;
}

// Get a single entity by primary key
getEntity<T>(sandboxId: string, entityType: keyof EntityStore, primaryKey: string): T | undefined {
  const collection = this.getEntityCollection<T>(sandboxId, entityType);
  return collection.get(primaryKey);
}

// Find entities matching a predicate
findEntities<T>(sandboxId: string, entityType: keyof EntityStore, predicate: (entity: T) => boolean): T[] {
  const collection = this.getEntityCollection<T>(sandboxId, entityType);
  return Array.from(collection.values()).filter(predicate);
}
```
</sandbox_service_entity_methods>

<update_sandbox_entities>
## Updating Sandbox Entities via PUT /sandboxes/:sandboxId

The update endpoint should allow adding, modifying, or removing entities:

```typescript
// PUT body structure
{
  "entities": {
    "customers": {
      "add": [{ "customerCode": "999", "name": "New Customer", "taxNo": "111222333", ... }],
      "update": { "1317952138": { "name": "Updated Name" } },
      "remove": ["old-customer-code"]
    },
    "cards": {
      "add": [{ "cardNumber": "1234567890123456", "customerCode": "999", ... }]
    }
  }
}
```

This allows test scenarios to:
- Add multiple customers to test search functionality
- Modify entity fields to test different states (e.g., blocked cards, inactive accounts)
- Remove entities to test empty-result scenarios
</update_sandbox_entities>
