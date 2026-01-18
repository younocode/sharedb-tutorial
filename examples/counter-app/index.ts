/**
 * Counter Example - Demonstrates collaborative counter using OT
 *
 * This example shows:
 * 1. Setting up a server and multiple clients
 * 2. Creating a shared counter document
 * 3. Submitting concurrent operations
 * 4. Observing how OT ensures convergence
 *
 * Run with: npx ts-node examples/counter-app/index.ts
 */

import { Backend, Agent } from '../../src/server/backend';
import { Connection, Transport, Message, MessageType } from '../../src/client/connection';
import { Doc } from '../../src/client/doc';
import { types } from '../../src/core/types';
import { counterType } from '../../src/types/counter';

// Register the counter type
types.register(counterType);

/**
 * Simulated transport that connects client and server directly
 * In a real application, this would be a WebSocket connection
 */
function createConnection(backend: Backend): { connection: Connection; agent: Agent } {
  const agent = backend.createAgent();
  const connection = new Connection();

  // Transport: client -> server
  const transport: Transport = {
    send(message: Message) {
      // Small delay to simulate network
      setImmediate(() => agent.handleMessage(message));
    },
    close() {
      agent.close();
    },
  };

  // Server -> client
  agent.bindSend((message) => {
    setImmediate(() => connection.handleMessage(message as Message));
  });

  connection.bindToTransport(transport);

  // Simulate handshake
  connection.handleMessage({
    a: MessageType.HANDSHAKE,
    id: agent.clientId,
  });

  return { connection, agent };
}

/**
 * Wait for a promise with timeout
 */
function wait(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

/**
 * Wait for a condition
 */
async function waitFor(condition: () => boolean, timeout = 2000): Promise<void> {
  const start = Date.now();
  while (!condition()) {
    if (Date.now() - start > timeout) {
      throw new Error('Timeout');
    }
    await wait(10);
  }
}

async function main() {
  console.log('=== Counter Example ===\n');
  console.log('This example demonstrates OT with a simple counter.\n');

  // Create server
  const backend = new Backend();
  console.log('✓ Server created\n');

  // Create two clients
  const { connection: conn1 } = createConnection(backend);
  const { connection: conn2 } = createConnection(backend);
  console.log('✓ Two clients connected\n');

  // Get the shared counter document
  const doc1 = conn1.get('counters', 'shared-counter');
  const doc2 = conn2.get('counters', 'shared-counter');

  // Subscribe both clients and wait for completion
  await new Promise<void>((resolve) => doc1.subscribe(() => resolve()));
  console.log('Client 1 subscribed');

  // Client 1 creates the counter with initial value 0
  console.log('Client 1: Creating counter with initial value 0...');
  await new Promise<void>((resolve, reject) => {
    doc1.create('counter', 0, (err) => (err ? reject(err) : resolve()));
  });
  await waitFor(() => doc1.version === 1);
  console.log(`  → doc1: version=${doc1.version}, data=${doc1.data}`);

  // Now subscribe client 2 (it will get the created document)
  await new Promise<void>((resolve) => doc2.subscribe(() => resolve()));
  console.log('Client 2 subscribed');
  console.log(`  → doc2: version=${doc2.version}, data=${doc2.data}`);
  console.log('');

  // Sequential operations to show basic sync
  console.log('--- Sequential Operations ---');

  console.log('Client 1 adds +5...');
  await new Promise<void>((resolve) => doc1.submitOp(5, () => resolve()));
  await wait(50);
  await waitFor(() => doc2.data === 5);
  console.log(`  → doc1: data=${doc1.data}`);
  console.log(`  → doc2: data=${doc2.data} (received update)`);
  console.log('');

  console.log('Client 2 adds +3...');
  await new Promise<void>((resolve) => doc2.submitOp(3, () => resolve()));
  await wait(50);
  await waitFor(() => doc1.data === 8);
  console.log(`  → doc1: data=${doc1.data} (received update)`);
  console.log(`  → doc2: data=${doc2.data}`);
  console.log('');

  // Verify final state
  if (doc1.data === doc2.data && doc1.data === 8) {
    console.log('✓ SUCCESS: Both clients have consistent value (8)!');
  } else {
    console.log('✗ ERROR: Clients diverged!');
  }
  console.log('');

  // Demonstrate concurrent operations through the server
  console.log('--- Server-side OT Demonstration ---');
  console.log('Simulating concurrent operations that arrive at the server:');
  console.log('');

  const snapshot1 = await backend.getSnapshot('counters', 'shared-counter');
  console.log(`Current value: ${snapshot1.data} at version ${snapshot1.v}`);
  console.log(`Op A: +10 at version ${snapshot1.v}`);
  console.log(`Op B: +7 at version ${snapshot1.v} (concurrent)`);
  console.log('');

  // Submit directly to backend to show server-side OT
  await backend.submit('counters', 'shared-counter', { op: 10, v: snapshot1.v });
  await backend.submit('counters', 'shared-counter', { op: 7, v: snapshot1.v }); // Will be transformed

  // Get final state from server
  const finalSnapshot = await backend.getSnapshot('counters', 'shared-counter');
  console.log(`Server final state: version=${finalSnapshot.v}, data=${finalSnapshot.data}`);
  console.log('');
  console.log(`Even though both ops targeted version ${snapshot1.v}, OT transformed them`);
  console.log(`so they could both be applied: ${snapshot1.data} + 10 + 7 = ${finalSnapshot.data}`);
  console.log('');

  console.log('=== Example Complete ===');

  // Clean up
  conn1.close();
  conn2.close();
  backend.close();
}

main().catch(console.error);
