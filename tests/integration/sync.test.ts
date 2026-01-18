/**
 * Integration tests for full client-server synchronization
 *
 * These tests verify that:
 * 1. Operations flow correctly between client and server
 * 2. Concurrent operations converge to the same state
 * 3. The OT transformation produces correct results
 */

import { describe, it, expect, beforeEach } from 'vitest';
import { Backend, Agent } from '../../src/server/backend';
import { Connection, Transport, Message, MessageType } from '../../src/client/connection';
import { Doc } from '../../src/client/doc';
import { types } from '../../src/core/types';
import { counterType } from '../../src/types/counter';
import { textType } from '../../src/types/text';

// Register types
types.register(counterType);
types.register(textType);

/**
 * Creates a connected client-server pair using direct message passing
 */
function createClientServerPair(): {
  backend: Backend;
  agent: Agent;
  connection: Connection;
} {
  const backend = new Backend();
  const agent = backend.createAgent();
  const connection = new Connection();

  // Create a simple transport that passes messages directly
  const transport: Transport = {
    send(message: Message) {
      // Client -> Server
      setTimeout(() => agent.handleMessage(message), 0);
    },
    close() {
      agent.close();
    },
  };

  // Bind agent send to connection
  agent.bindSend((message) => {
    // Server -> Client
    setTimeout(() => connection.handleMessage(message as Message), 0);
  });

  connection.bindToTransport(transport);

  // Simulate handshake
  connection.handleMessage({
    a: MessageType.HANDSHAKE,
    id: agent.clientId,
  });

  return { backend, agent, connection };
}

/**
 * Wait for a condition to be true
 */
function waitFor(condition: () => boolean, timeout = 1000): Promise<void> {
  return new Promise((resolve, reject) => {
    const start = Date.now();
    const check = () => {
      if (condition()) {
        resolve();
      } else if (Date.now() - start > timeout) {
        reject(new Error('Timeout waiting for condition'));
      } else {
        setTimeout(check, 10);
      }
    };
    check();
  });
}

describe('Integration Tests', () => {
  describe('Basic Operations', () => {
    let backend: Backend;
    let connection: Connection;

    beforeEach(() => {
      const pair = createClientServerPair();
      backend = pair.backend;
      connection = pair.connection;
    });

    it('should create and retrieve a document', async () => {
      const doc = connection.get('test', 'doc1');

      // Subscribe and wait for response
      await new Promise<void>((resolve) => {
        doc.subscribe(() => resolve());
      });

      // Create document
      await new Promise<void>((resolve, reject) => {
        doc.create('counter', 10, (err) => {
          if (err) reject(err);
          else resolve();
        });
      });

      // Wait for acknowledgement
      await waitFor(() => doc.version === 1);

      expect(doc.type).toBe(counterType);
      expect(doc.data).toBe(10);
      expect(doc.version).toBe(1);
    });

    it('should submit and apply operations', async () => {
      const doc = connection.get('test', 'doc1');

      await new Promise<void>((resolve) => doc.subscribe(() => resolve()));

      // Create document
      await new Promise<void>((resolve, reject) => {
        doc.create('counter', 0, (err) => {
          if (err) reject(err);
          else resolve();
        });
      });

      await waitFor(() => doc.version === 1);

      // Submit operation
      await new Promise<void>((resolve, reject) => {
        doc.submitOp(5, (err) => {
          if (err) reject(err);
          else resolve();
        });
      });

      await waitFor(() => doc.version === 2);

      expect(doc.data).toBe(5);
    });
  });

  describe('Two Client Synchronization', () => {
    let backend: Backend;
    let client1: Connection;
    let client2: Connection;
    let agent1: Agent;
    let agent2: Agent;

    beforeEach(() => {
      backend = new Backend();

      // Set up client 1
      agent1 = backend.createAgent();
      client1 = new Connection();

      const transport1: Transport = {
        send(message: Message) {
          setTimeout(() => agent1.handleMessage(message), 0);
        },
        close() {
          agent1.close();
        },
      };

      agent1.bindSend((message) => {
        setTimeout(() => client1.handleMessage(message as Message), 0);
      });

      client1.bindToTransport(transport1);
      client1.handleMessage({ a: MessageType.HANDSHAKE, id: agent1.clientId });

      // Set up client 2
      agent2 = backend.createAgent();
      client2 = new Connection();

      const transport2: Transport = {
        send(message: Message) {
          setTimeout(() => agent2.handleMessage(message), 0);
        },
        close() {
          agent2.close();
        },
      };

      agent2.bindSend((message) => {
        setTimeout(() => client2.handleMessage(message as Message), 0);
      });

      client2.bindToTransport(transport2);
      client2.handleMessage({ a: MessageType.HANDSHAKE, id: agent2.clientId });
    });

    it('should synchronize document creation', async () => {
      const doc1 = client1.get('test', 'shared');
      const doc2 = client2.get('test', 'shared');

      // Both subscribe
      await Promise.all([
        new Promise<void>((resolve) => doc1.subscribe(() => resolve())),
        new Promise<void>((resolve) => doc2.subscribe(() => resolve())),
      ]);

      // Client 1 creates the document
      await new Promise<void>((resolve, reject) => {
        doc1.create('counter', 100, (err) => {
          if (err) reject(err);
          else resolve();
        });
      });

      await waitFor(() => doc1.version === 1);

      // Wait for client 2 to receive the create
      await waitFor(() => doc2.type !== null && doc2.version === 1);

      expect(doc2.type).toBe(counterType);
      expect(doc2.data).toBe(100);
    });

    it('should handle concurrent operations and converge', async () => {
      const doc1 = client1.get('test', 'concurrent');
      const doc2 = client2.get('test', 'concurrent');

      // Subscribe both
      await Promise.all([
        new Promise<void>((resolve) => doc1.subscribe(() => resolve())),
        new Promise<void>((resolve) => doc2.subscribe(() => resolve())),
      ]);

      // Client 1 creates the document
      await new Promise<void>((resolve, reject) => {
        doc1.create('counter', 0, (err) => {
          if (err) reject(err);
          else resolve();
        });
      });

      await waitFor(() => doc1.version === 1 && doc2.version === 1);

      // Now both clients submit operations "concurrently"
      // Client 1: +5
      // Client 2: +3
      const p1 = new Promise<void>((resolve, reject) => {
        doc1.submitOp(5, (err) => {
          if (err) reject(err);
          else resolve();
        });
      });

      const p2 = new Promise<void>((resolve, reject) => {
        doc2.submitOp(3, (err) => {
          if (err) reject(err);
          else resolve();
        });
      });

      await Promise.all([p1, p2]);

      // Wait for both to converge
      await waitFor(() => doc1.version! >= 3 && doc2.version! >= 3, 2000);

      // Both should have the same final value: 0 + 5 + 3 = 8
      expect(doc1.data).toBe(doc2.data);
      expect(doc1.data).toBe(8);
    });
  });

  describe('Server-side Transform', () => {
    it('should transform ops when version is behind', async () => {
      const backend = new Backend();

      // Submit first op directly
      await backend.submit('test', 'doc1', {
        create: { type: counterType.uri, data: 0 },
        v: 0,
      });

      // Submit second op
      await backend.submit('test', 'doc1', {
        op: 10,
        v: 1,
      });

      // Submit op with old version - should be transformed
      const result = await backend.submit('test', 'doc1', {
        op: 5,
        v: 1, // Behind by 1
      });

      // The op should have been transformed and applied
      expect(result.snapshot.data).toBe(15); // 0 + 10 + 5 = 15
      expect(result.snapshot.v).toBe(3);
    });
  });
});
