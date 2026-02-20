<parsing_overview>
This reference describes how to parse API request/response data provided by the user and extract controllers, endpoints, and DTO structures for the NestJS sandbox service generation.
</parsing_overview>

<input_format>
The input data follows a repeating pattern of blocks:

```
[URL]
[blank line or request JSON]
[request JSON body]
[blank line]
[response JSON body]
[blank lines]
[next URL...]
```

Each block represents one API call with:
1. **URL line** - Full URL of the API endpoint (starts with `http://` or `https://`)
2. **Request body** - JSON object with `header` and `payload` fields
3. **Response body** - JSON object with `payload`, `exception`, `messages`, `executionTime` fields
</input_format>

<url_segment_extraction>
After stripping the base URL (protocol + host + port) and environment-specific path prefixes (e.g., `/CBSTESTPLEX/`), the remaining path follows the format:

```
{api}/{controller}/{action}
```

Where:
- **api** - The API group identifier (e.g., `apiCra`, `cosmosCraApi`, `apiOtherServices`). Identifies which API group the endpoint belongs to.
- **controller** - The resource/entity the endpoint operates on (e.g., `customer`, `position`, `cards`). This becomes the NestJS controller name.
- **action** - The specific operation (e.g., `SimpleSearch`, `GetCustomerProducts`, `fetchCreditCardFullData`). This becomes the endpoint method name.

**Parsing strategy:**
1. Strip the base URL (protocol + host + port)
2. Remove environment-specific path prefixes (e.g., `/CBSTESTPLEX/`)
3. Split remaining path into segments
4. Map segments to `{api}/{controller}/{action}`

**Examples from banking APIs (illustrative — actual entities are discovered from the data):**
- `.../apiCra/customer/SimpleSearch` → api: `apiCra`, controller: `customer`, action: `SimpleSearch`
- `.../cosmosCraApi/position/GetCustomerProducts` → api: `cosmosCraApi`, controller: `position`, action: `GetCustomerProducts`
- `.../apiOtherServices/cards/fetchCreditCardFullData` → api: `apiOtherServices`, controller: `cards`, action: `fetchCreditCardFullData`
- `.../apiOtherServices/cards/fetchTransactions` → api: `apiOtherServices`, controller: `cards`, action: `fetchTransactions` (same controller, different action)
- `.../apiLending/loans/GetLoanDetails` → api: `apiLending`, controller: `loans`, action: `GetLoanDetails`
- `.../apiAccounts/deposits/GetBalances` → api: `apiAccounts`, controller: `deposits`, action: `GetBalances`

**Controller grouping rule:** Endpoints sharing the same controller segment (middle path component) belong to the same NestJS controller. Each unique controller value produces one controller module.

**Action name extraction:** The last path segment becomes the endpoint method name, converted to camelCase:
- `SimpleSearch` → `simpleSearch`
- `GetCustomerProducts` → `getCustomerProducts`
- `fetchCreditCardFullData` → `fetchCreditCardFullData`
</url_segment_extraction>

<ambiguity_handling>
When the URL path after stripping base URL and prefix does **not** clearly fit the `{api}/{controller}/{action}` three-segment pattern, the agent MUST ask the user for clarification using `AskUserQuestion`.

**Ambiguity triggers:**
- More than 3 path segments remain (e.g., `apiGroup/subGroup/resource/action/extra`)
- Fewer than 3 path segments remain (e.g., `apiGroup/action`)
- The segment roles are unclear (e.g., cannot confidently determine which segment is the api vs controller)

**When ambiguity is detected, use AskUserQuestion:**
Present the problematic URL and the extracted segments, then ask the user to identify which segment maps to api, controller, and action.

Example question structure:
```
"I found a URL that doesn't clearly fit the {api}/{controller}/{action} pattern:

URL: https://host/PREFIX/segmentA/segmentB/segmentC/segmentD

Extracted segments: segmentA, segmentB, segmentC, segmentD

Which segment is the API group, which is the controller, and which is the action?"
```

Provide options based on the most likely interpretations, and let the user confirm or correct.
</ambiguity_handling>

<dto_inference>
DTOs are inferred from the JSON request and response structures.

**Request DTO inference:**
- Extract the `payload` field from the request body
- Each top-level field in `payload` becomes a DTO property
- Nested objects become nested DTOs or embedded interfaces
- Arrays indicate list types

**Response DTO inference:**
- Extract the `payload` field from the response body
- Follow the same rules as request DTOs
- Preserve exact field names and types from the sample data

**Type mapping from JSON values:**
| JSON type | TypeScript type | Swagger decorator |
|-----------|----------------|-------------------|
| `"string"` | `string` | `@ApiProperty({ type: String })` |
| `123` or `123.0` | `number` | `@ApiProperty({ type: Number })` |
| `true`/`false` | `boolean` | `@ApiProperty({ type: Boolean })` |
| `null` | nullable field | `@ApiPropertyOptional()` |
| `{}` (object) | nested DTO class | `@ApiProperty({ type: NestedDto })` |
| `[]` (array) | typed array | `@ApiProperty({ type: [ItemDto] })` |
| `"2023-01-13T..."` | `string` (ISO date) | `@ApiProperty({ type: String, format: 'date-time' })` |

**Naming conventions for generated DTOs:**
- Request payload DTO: `{ActionName}RequestDto` (e.g., `SimpleSearchRequestDto`)
- Response payload DTO: `{ActionName}ResponseDto` (e.g., `SimpleSearchResponseDto`)
- Nested object DTOs: `{ParentName}{FieldName}Dto` (e.g., `CustomerBranchDto`)
</dto_inference>

<header_structure>
The standard header structure appears across all API calls:

```json
{
  "header": {
    "Application": "UUID",
    "Bank": "NBG",
    "Channel": "intranet",
    "ID": "UUID"
  }
}
```

Generate a shared `ApiHeaderDto` class reused across all controllers. The `Application` and `ID` fields should be auto-generated UUIDs in the sandbox. `Bank` and `Channel` can use defaults from the sample data.
</header_structure>

<synthetic_data_generation>
When seeding sandbox data, use the provided response samples as seed data:

1. Use the exact response structure from the sample
2. Preserve field names, types, and nesting
3. For lists/arrays, keep the sample items as seed data
4. For identifiers (customerCode, cardNumber, account), use the sample values as defaults
5. The sandbox should return this seed data when the matching endpoint is called

**Data isolation per sandbox:**
Each sandbox gets its own copy of the seed data. Modifications through the sandbox update API affect only that sandbox's data.
</synthetic_data_generation>

<parsing_algorithm>
Step-by-step algorithm to parse input data:

1. **Read input** - Read the file, directory contents, or inline text
2. **Split into blocks** - Split on URL patterns (lines starting with `http://` or `https://`)
3. **For each block:**
   a. Extract URL from first line
   b. Find request JSON (first `{...}` block after URL)
   c. Find response JSON (second `{...}` block, typically the larger one with `payload`)
   d. Parse URL to extract api, controller, and action segments
   e. **If URL does not fit `{api}/{controller}/{action}` pattern** → use AskUserQuestion to clarify with the user
   f. Parse request JSON to extract payload structure
   g. Parse response JSON to extract payload structure
4. **Group by controller** - Collect all endpoints with the same controller segment
5. **Generate DTOs** - Infer TypeScript interfaces/classes from JSON structures
6. **Identify shared structures** - Find common DTOs across endpoints (e.g., ApiHeaderDto)
</parsing_algorithm>
