/**
 * Backend - Server-side orchestrator
 *
 * Reference: lib/backend.js in ShareDB
 *
 * The Backend is the main entry point for server-side ShareDB.
 * It manages:
 * - Database connections
 * - Agent (client session) management
 * - Operation submission and broadcasting
 * - Pub/Sub for horizontal scaling (simplified here)
 *
 * In this simplified tutorial version, we focus on the core
 * functionality without middleware, projections, or full pub/sub.
 */

import { EventEmitter } from "events";
import { MemoryDb } from "./memory-db";
import { submitOp, SubmitResult } from "./submit-request";
import { Op } from "../core/ot";
import { Snapshot } from "../core/snapshot";

/**
 * Agent - Represents a connected client on the server
 *
 * Reference: lib/agent.js in ShareDB
 *
 * Each connected client has an Agent that:
 * - Tracks their subscriptions
 * - Routes messages to/from the client
 * - Maintains client-specific state
 */
export class Agent extends EventEmitter {
  /** Unique client ID */
  public readonly clientId: string;

  /** Parent backend */
  public readonly backend: Backend;

  /** Document subscriptions: collection -> Set of doc IDs */
  private subscriptions: Map<string, Set<string>> = new Map();

  /** Send function (injected by transport) */
  private sendFn: ((message: unknown) => void) | null = null;

  constructor(backend: Backend, clientId: string) {
    super();
    this.backend = backend;
    this.clientId = clientId;
  }

  /**
   * Bind a send function to this agent.
   */
  bindSend(send: (message: unknown) => void): void {
    this.sendFn = send;
  }

  /**
   * Send a message to the client.
   */
  send(message: unknown): void {
    if (this.sendFn) {
      this.sendFn(message);
    }
  }

  /**
   * Handle a message from the client.
   */
  async handleMessage(message: any): Promise<void> {
    switch (message.a) {
      case "s": // Subscribe
        await this._handleSubscribe(message);
        break;
      case "us": // Unsubscribe
        await this._handleUnsubscribe(message);
        break;
      case "op": // Operation
        await this._handleOp(message);
        break;
      case "f": // Fetch
        await this._handleFetch(message);
        break;
      default:
        console.warn("Unknown message action:", message.a);
    }
  }

  /**
   * Handle subscribe request.
   */
  private async _handleSubscribe(message: {
    c: string;
    d: string;
  }): Promise<void> {
    const { c: collection, d: id } = message;

    try {
      // Get current snapshot
      const snapshot = await this.backend.db.getSnapshot(collection, id);

      // Add to subscriptions
      let docIds = this.subscriptions.get(collection);
      if (!docIds) {
        docIds = new Set();
        this.subscriptions.set(collection, docIds);
      }
      docIds.add(id);

      // Register with backend for broadcasts
      this.backend._subscribe(collection, id, this);

      // Send snapshot to client
      this.send({
        a: "s",
        c: collection,
        d: id,
        data: snapshot,
      });
    } catch (error: any) {
      this.send({
        a: "s",
        c: collection,
        d: id,
        error: { code: error.code || "ERR_UNKNOWN", message: error.message },
      });
    }
  }

  /**
   * Handle unsubscribe request.
   */
  private async _handleUnsubscribe(message: {
    c: string;
    d: string;
  }): Promise<void> {
    const { c: collection, d: id } = message;

    const docIds = this.subscriptions.get(collection);
    if (docIds) {
      docIds.delete(id);
    }

    this.backend._unsubscribe(collection, id, this);

    this.send({
      a: "us",
      c: collection,
      d: id,
    });
  }

  /**
   * Handle fetch request.
   */
  private async _handleFetch(message: { c: string; d: string }): Promise<void> {
    const { c: collection, d: id } = message;

    try {
      const snapshot = await this.backend.db.getSnapshot(collection, id);
      this.send({
        a: "f",
        c: collection,
        d: id,
        data: snapshot,
      });
    } catch (error: any) {
      this.send({
        a: "f",
        c: collection,
        d: id,
        error: { code: error.code || "ERR_UNKNOWN", message: error.message },
      });
    }
  }

  /**
   * Handle operation submission.
   */
  private async _handleOp(message: {
    c: string;
    d: string;
    v?: number;
    op?: unknown;
    create?: { type: string; data?: unknown };
    del?: boolean;
    src?: string;
    seq?: number;
  }): Promise<void> {
    const { c: collection, d: id, src, seq } = message;

    // Build the operation
    const op: Op & { src?: string; seq?: number } = {
      v: message.v,
      src,
      seq,
    } as any;

    if (message.create) {
      (op as any).create = message.create;
    } else if (message.del) {
      (op as any).del = true;
    } else if (message.op !== undefined) {
      (op as any).op = message.op;
    }

    try {
      // Submit the operation
      const result = await this.backend.submit(collection, id, op);

      // Send acknowledgement to the submitting client
      this.send({
        a: "op",
        c: collection,
        d: id,
        v: result.snapshot.v,
        src,
        seq,
      });

      // Broadcast to other subscribers
      this.backend._broadcast(
        collection,
        id,
        {
          a: "op",
          c: collection,
          d: id,
          v: result.op.v,
          src,
          seq,
          ...("create" in result.op && result.op.create
            ? { create: result.op.create }
            : {}),
          ...("del" in result.op && result.op.del ? { del: true } : {}),
          ...("op" in result.op ? { op: result.op.op } : {}),
        },
        this,
      );
    } catch (error: any) {
      this.send({
        a: "op",
        c: collection,
        d: id,
        src,
        seq,
        error: { code: error.code || "ERR_UNKNOWN", message: error.message },
      });
    }
  }

  /**
   * Check if subscribed to a document.
   */
  isSubscribed(collection: string, id: string): boolean {
    return this.subscriptions.get(collection)?.has(id) ?? false;
  }

  /**
   * Clean up when agent disconnects.
   */
  close(): void {
    // Unsubscribe from all documents
    for (const [collection, docIds] of this.subscriptions) {
      for (const id of docIds) {
        this.backend._unsubscribe(collection, id, this);
      }
    }
    this.subscriptions.clear();
    this.emit("close");
  }
}

/**
 * Backend options
 */
export interface BackendOptions {
  /** Database instance (defaults to MemoryDb) */
  db?: MemoryDb;
}

/**
 * Backend - Main server-side class
 */
export class Backend extends EventEmitter {
  /** The database */
  public readonly db: MemoryDb;

  /** Connected agents */
  private agents: Set<Agent> = new Set();

  /** Subscriptions: collection -> id -> Set of agents */
  private subscriptionsByDoc: Map<string, Map<string, Set<Agent>>> = new Map();

  /** Counter for generating client IDs */
  private clientIdCounter: number = 0;

  constructor(options: BackendOptions = {}) {
    super();
    this.db = options.db || new MemoryDb();
  }

  /**
   * Create a new agent for a client connection.
   *
   * @returns New Agent instance
   */
  createAgent(): Agent {
    const clientId = (++this.clientIdCounter).toString(36);
    const agent = new Agent(this, clientId);
    this.agents.add(agent);

    agent.on("close", () => {
      this.agents.delete(agent);
    });

    return agent;
  }

  /**
   * Submit an operation to a document.
   *
   * @param collection - Collection name
   * @param id - Document ID
   * @param op - The operation
   * @returns Submit result
   */
  async submit(collection: string, id: string, op: Op): Promise<SubmitResult> {
    const result = await submitOp(this.db, collection, id, op);
    this.emit("submit", collection, id, result);
    return result;
  }

  /**
   * Get a snapshot from the database.
   */
  async getSnapshot(collection: string, id: string): Promise<Snapshot> {
    return this.db.getSnapshot(collection, id);
  }

  /**
   * Subscribe an agent to a document (internal).
   */
  _subscribe(collection: string, id: string, agent: Agent): void {
    let collectionSubs = this.subscriptionsByDoc.get(collection);
    if (!collectionSubs) {
      collectionSubs = new Map();
      this.subscriptionsByDoc.set(collection, collectionSubs);
    }

    let docSubs = collectionSubs.get(id);
    if (!docSubs) {
      docSubs = new Set();
      collectionSubs.set(id, docSubs);
    }

    docSubs.add(agent);
  }

  /**
   * Unsubscribe an agent from a document (internal).
   */
  _unsubscribe(collection: string, id: string, agent: Agent): void {
    const collectionSubs = this.subscriptionsByDoc.get(collection);
    if (!collectionSubs) return;

    const docSubs = collectionSubs.get(id);
    if (!docSubs) return;

    docSubs.delete(agent);

    // Clean up empty sets
    if (docSubs.size === 0) {
      collectionSubs.delete(id);
    }
    if (collectionSubs.size === 0) {
      this.subscriptionsByDoc.delete(collection);
    }
  }

  /**
   * Broadcast a message to all subscribers of a document (internal).
   *
   * @param collection - Collection name
   * @param id - Document ID
   * @param message - Message to broadcast
   * @param excludeAgent - Agent to exclude (usually the one who submitted)
   */
  _broadcast(
    collection: string,
    id: string,
    message: unknown,
    excludeAgent?: Agent,
  ): void {
    const collectionSubs = this.subscriptionsByDoc.get(collection);
    if (!collectionSubs) return;

    const docSubs = collectionSubs.get(id);
    if (!docSubs) return;

    for (const agent of docSubs) {
      if (agent !== excludeAgent) {
        agent.send(message);
      }
    }
  }

  /**
   * Close the backend.
   */
  close(): void {
    for (const agent of this.agents) {
      agent.close();
    }
    this.agents.clear();
    this.subscriptionsByDoc.clear();
    this.emit("close");
  }
}
