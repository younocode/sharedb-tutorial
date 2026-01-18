# ShareDB Tutorial

A simplified TypeScript implementation of OT (Operational Transformation) for learning real-time collaboration systems.

This project is a teaching-focused implementation that mirrors [ShareDB](https://github.com/share/sharedb)'s architecture while being simple enough to understand completely.

## What is OT?

Operational Transformation (OT) is an algorithm that enables real-time collaborative editing. When multiple users edit the same document simultaneously, OT ensures everyone ends up with the same result, regardless of network delays or the order operations arrive.

### The Core Problem

```
Initial text: "hello"

Client A: Insert 'X' at position 1 → "hXello"
Client B: Insert 'Y' at position 4 → "hellYo"

Without OT: Results diverge depending on order
With OT: Both converge to "hXellYo"
```

### The Solution: Transform

When Client B's operation arrives after A's:
- B's position 4 must be adjusted because A inserted before it
- Position 4 becomes position 5
- Result: consistent "hXellYo" for everyone

## Project Structure

```
src/
├── core/
│   ├── types.ts       # OTType interface and TypeRegistry
│   ├── snapshot.ts    # Document snapshot structure
│   ├── error.ts       # Custom error types
│   └── ot.ts          # Core OT functions: checkOp, apply, transform
├── types/
│   ├── counter.ts     # Simple counter type (commutative ops)
│   └── text.ts        # Text type (requires position transform)
├── client/
│   ├── connection.ts  # Client-server communication
│   └── doc.ts         # Client-side document with inflightOp/pendingOps
└── server/
    ├── memory-db.ts   # In-memory database
    ├── submit-request.ts # Server-side op processing
    └── backend.ts     # Server orchestrator
```

## Quick Start

```bash
# Install dependencies
npm install

# Run tests
npm test

# Run examples
npm run example:counter
npm run example:text

# Build
npm run build
```

## Key Concepts

### 1. Snapshot

A snapshot represents document state at a point in time:

```typescript
interface Snapshot {
  id: string;      // Document ID
  v: number;       // Version (increments with each op)
  type: string;    // OT type name (null if not created)
  data: any;       // Document data
}
```

### 2. Operations

Three operation types:

```typescript
// Create a new document
{ create: { type: 'counter', data: 10 } }

// Edit an existing document
{ op: 5 }  // For counter: add 5

// Delete a document
{ del: true }
```

### 3. OT Types

Each type implements:

```typescript
interface OTType<TSnapshot, TOp> {
  name: string;
  uri: string;
  create(data?): TSnapshot;
  apply(snapshot: TSnapshot, op: TOp): TSnapshot;
  transform(op1: TOp, op2: TOp, side: 'left' | 'right'): TOp;
}
```

### 4. Client State Machine

The client maintains operation queues:

```
[pendingOps] → [inflightOp] → Server → Ack
     ↑              ↑
     └──────────────┴── Transform against remote ops
```

**Key rule**: Only ONE operation in-flight at a time!

### 5. Server Processing

When an op arrives:
1. Fetch current snapshot
2. If op.v < snapshot.v, transform against intermediate ops
3. Apply op to snapshot
4. Commit (with optimistic locking)
5. Broadcast to subscribers

## The Two OT Types Explained

### Counter Type (Simple)

Counter operations are **commutative** - order doesn't matter:

```typescript
// Addition commutes: 5 + 3 = 3 + 5
transform(op1, op2, side) {
  return op1;  // No transformation needed!
}
```

This is the simplest possible OT type. It demonstrates that when operations commute, OT is trivial.

### Text Type (Real OT)

Text operations are **not commutative** - order matters!

```typescript
// Insert 'A' at position 2, then 'B' at position 5
// vs
// Insert 'B' at position 5, then 'A' at position 2
// Different results!

transform(op1, op2, side) {
  // If op2 inserted before op1's position, shift right
  if (op2.pos < op1.pos) {
    return { ...op1, pos: op1.pos + op2.text.length };
  }
  // Tie-breaking for same position
  if (op2.pos === op1.pos && side === 'right') {
    return { ...op1, pos: op1.pos + op2.text.length };
  }
  return op1;
}
```

## Code Walkthrough

### Creating a Document

```typescript
import { Connection, Backend, types } from 'sharedb-tutorial';
import { counterType } from 'sharedb-tutorial/types/counter';

// Register type
types.register(counterType);

// Server side
const backend = new Backend();

// Client side
const connection = new Connection();
const doc = connection.get('counters', 'my-counter');

// Subscribe to updates
doc.subscribe(() => {
  // Create with initial value
  doc.create('counter', 0, (err) => {
    // Submit operations
    doc.submitOp(5);  // Add 5
    doc.submitOp(-3); // Subtract 3
  });
});
```

### The Transform Function

The heart of OT - from `src/core/ot.ts`:

```typescript
export function transform(type, op, appliedOp) {
  // Both are edit operations
  if ('op' in op && 'op' in appliedOp) {
    // Use type's transform function
    op.op = type.transform(op.op, appliedOp.op, 'left');
  }

  // Increment version
  if (op.v != null) op.v++;
}
```

### Client-side OT - from `src/client/doc.ts`:

```typescript
_handleOp(message) {
  // Transform our pending ops against remote op
  if (this.inflightOp) {
    transformX(this.inflightOp, message);
  }
  for (const pendingOp of this.pendingOps) {
    transformX(pendingOp, message);
  }

  // Apply to local state
  this.version++;
  this._otApply(message, false);
}
```

## Comparison with ShareDB

| Aspect | ShareDB | This Tutorial |
|--------|---------|---------------|
| Language | JavaScript (ES3) | TypeScript |
| Types | ot-json0 default | counter, simple-text |
| Database | Pluggable adapters | Memory only |
| Pub/Sub | Redis support | In-process only |
| Middleware | Full pipeline | None |
| Queries | Supported | Not implemented |
| Presence | Supported | Not implemented |

## Learning Path

1. **Start with counter type** (`src/types/counter.ts`)
   - Understand that commutative ops need no transform

2. **Study text type** (`src/types/text.ts`)
   - See how position adjustment works

3. **Trace an operation through the system**
   - Client: `doc.submitOp()` → `_submit()` → `flush()` → `sendOp()`
   - Server: `handleMessage()` → `submitOp()` → `transform()` → `apply()` → `commit()`
   - Broadcast: `_broadcast()` → other clients → `_handleOp()` → `transformX()`

4. **Run the examples**
   ```bash
   npm run example:counter
   npm run example:text
   ```

5. **Read the tests** (`tests/`)
   - They demonstrate edge cases and expected behavior

## Key Files to Read

| File | Why |
|------|-----|
| `src/core/ot.ts` | Core OT functions |
| `src/types/counter.ts` | Simplest OT type |
| `src/types/text.ts` | Real transform logic |
| `src/client/doc.ts` | Client state machine |
| `src/server/submit-request.ts` | Server transform |

## References

- [ShareDB GitHub](https://github.com/share/sharedb)
- [Understanding OT](http://www.codecommit.com/blog/java/understanding-and-applying-operational-transformation)
- [OT Explained](https://operational-transformation.github.io/)

## License

MIT
