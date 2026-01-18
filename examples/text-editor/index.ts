/**
 * Text Editor Example - Demonstrates collaborative text editing using OT
 *
 * This example shows:
 * 1. How text operations need position transformation
 * 2. Sequential edits
 * 3. Server-side concurrent edit handling
 *
 * Run with: npx ts-node examples/text-editor/index.ts
 */

import { Backend, Agent } from '../../src/server/backend';
import { Connection, Transport, Message, MessageType } from '../../src/client/connection';
import { types } from '../../src/core/types';
import { textType, InsertOp } from '../../src/types/text';

// Register the text type
types.register(textType);

/**
 * Create a connected client
 */
function createConnection(backend: Backend): { connection: Connection; agent: Agent } {
  const agent = backend.createAgent();
  const connection = new Connection();

  const transport: Transport = {
    send(message: Message) {
      setImmediate(() => agent.handleMessage(message));
    },
    close() {
      agent.close();
    },
  };

  agent.bindSend((message) => {
    setImmediate(() => connection.handleMessage(message as Message));
  });

  connection.bindToTransport(transport);
  connection.handleMessage({ a: MessageType.HANDSHAKE, id: agent.clientId });

  return { connection, agent };
}

function wait(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

async function waitFor(condition: () => boolean, timeout = 2000): Promise<void> {
  const start = Date.now();
  while (!condition()) {
    if (Date.now() - start > timeout) throw new Error('Timeout');
    await wait(10);
  }
}

async function main() {
  console.log('=== Text Editor Example ===\n');
  console.log('This example demonstrates OT with text editing.\n');
  console.log('Key insight: Unlike counters, text positions must be transformed!\n');

  // Create server and client
  const backend = new Backend();
  const { connection: conn1 } = createConnection(backend);

  const doc1 = conn1.get('documents', 'shared-text');

  // Subscribe
  await new Promise<void>((resolve) => doc1.subscribe(() => resolve()));

  // Create document with initial text
  console.log('Creating document with text: "hello"');
  await new Promise<void>((resolve, reject) => {
    doc1.create('simple-text', 'hello', (err) => (err ? reject(err) : resolve()));
  });
  await waitFor(() => doc1.version === 1);
  console.log(`  → Text: "${doc1.data}"\n`);

  // Sequential edits via client
  console.log('--- Sequential Client Edits ---');

  console.log('Insert "X" at position 1...');
  const op1: InsertOp = { type: 'insert', pos: 1, text: 'X' };
  await new Promise<void>((resolve) => doc1.submitOp(op1, () => resolve()));
  await wait(50);
  console.log(`  → Text: "${doc1.data}"\n`);

  console.log('Insert "Y" at position 4...');
  const op2: InsertOp = { type: 'insert', pos: 4, text: 'Y' };
  await new Promise<void>((resolve) => doc1.submitOp(op2, () => resolve()));
  await wait(50);
  console.log(`  → Text: "${doc1.data}"\n`);

  // Demonstrate server-side OT with concurrent operations
  console.log('--- Server-side Concurrent OT Demonstration ---\n');

  // Reset to a known state
  const snapshot1 = await backend.getSnapshot('documents', 'shared-text');
  console.log(`Current text: "${snapshot1.data}" at version ${snapshot1.v}`);
  console.log('');

  console.log('Simulating two concurrent operations at version 3:');
  console.log('  Op A: Insert "A" at position 0');
  console.log('  Op B: Insert "B" at position 0');
  console.log('');
  console.log('Without OT: Both would insert at position 0, causing inconsistency');
  console.log('With OT: Op B gets transformed so positions work correctly');
  console.log('');

  // Submit concurrent ops directly to server
  const opA: InsertOp = { type: 'insert', pos: 0, text: 'A' };
  const opB: InsertOp = { type: 'insert', pos: 0, text: 'B' };

  await backend.submit('documents', 'shared-text', { op: opA, v: snapshot1.v });
  await backend.submit('documents', 'shared-text', { op: opB, v: snapshot1.v }); // Concurrent!

  const snapshot2 = await backend.getSnapshot('documents', 'shared-text');
  console.log(`After both ops: "${snapshot2.data}"`);
  console.log('');

  // Explain the transformation
  console.log('=== Why Position Transformation Matters ===\n');
  console.log('Text before: "hXelYlo"');
  console.log('');
  console.log('Without OT, if both insert at position 0:');
  console.log('  Path 1: A first → "AhXelYlo", then B at 0 → "BAhXelYlo"');
  console.log('  Path 2: B first → "BhXelYlo", then A at 0 → "ABhXelYlo"');
  console.log('  Different results depending on order!');
  console.log('');
  console.log('With OT (using left priority for the transforming op):');
  console.log('  1. A inserts at pos 0 → "AhXelYlo"');
  console.log('  2. B transforms against A with left priority');
  console.log('     Left priority means B keeps pos 0 (doesn\'t shift)');
  console.log('  3. B inserts at pos 0 → "BAhXelYlo"');
  console.log('');
  console.log('Result is consistent: "' + snapshot2.data + '"');
  console.log('');

  console.log('=== Example Complete ===');

  conn1.close();
  backend.close();
}

main().catch(console.error);
