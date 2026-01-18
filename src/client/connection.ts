/**
 * Connection - Client-side connection management
 *
 * Reference: lib/client/connection.js in ShareDB
 *
 * The Connection manages communication between client and server.
 * It handles:
 * - Message sending and receiving
 * - Connection state (connecting, connected, disconnected)
 * - Document management (getting Doc instances)
 * - Unique client ID and sequence numbers for ops
 *
 * In ShareDB, this typically wraps a WebSocket, but for this tutorial
 * we use a simple message-based interface that can work with various transports.
 */

import { EventEmitter } from 'events';
import { Doc } from './doc';
import { Snapshot } from '../core/snapshot';
import { Op } from '../core/ot';

/**
 * Message types for client-server communication
 *
 * Reference: lib/message-actions.js in ShareDB
 */
export enum MessageType {
  /** Handshake - server sends client ID */
  HANDSHAKE = 'hs',
  /** Subscribe to document */
  SUBSCRIBE = 's',
  /** Submit operation */
  OP = 'op',
  /** Fetch document */
  FETCH = 'f',
  /** Unsubscribe from document */
  UNSUBSCRIBE = 'us',
}

/**
 * Base message interface
 */
export interface BaseMessage {
  /** Action/message type */
  a: MessageType;
  /** Collection name */
  c?: string;
  /** Document ID */
  d?: string;
}

/**
 * Handshake message from server
 */
export interface HandshakeMessage extends BaseMessage {
  a: MessageType.HANDSHAKE;
  /** Client ID assigned by server */
  id: string;
}

/**
 * Subscribe response message
 */
export interface SubscribeMessage extends BaseMessage {
  a: MessageType.SUBSCRIBE;
  c: string;
  d: string;
  /** Document data (snapshot) on success */
  data?: Snapshot;
  /** Error if subscription failed */
  error?: { code: string; message: string };
}

/**
 * Operation message (for sending and receiving ops)
 */
export interface OpMessage extends BaseMessage {
  a: MessageType.OP;
  c: string;
  d: string;
  /** The operation */
  op?: unknown;
  create?: { type: string; data?: unknown };
  del?: boolean;
  /** Version */
  v?: number;
  /** Source client ID */
  src?: string;
  /** Sequence number */
  seq?: number;
  /** Error if op failed */
  error?: { code: string; message: string };
}

/** Union of all message types */
export type Message = HandshakeMessage | SubscribeMessage | OpMessage | BaseMessage;

/**
 * Transport interface - abstraction for the underlying transport
 *
 * This allows the Connection to work with WebSockets, direct function calls,
 * or any other message-passing mechanism.
 */
export interface Transport {
  /** Send a message to the server */
  send(message: Message): void;
  /** Close the connection */
  close(): void;
}

/**
 * Connection class - manages client-server communication
 */
export class Connection extends EventEmitter {
  /** Unique client ID (assigned by server) */
  public id: string = '';

  /** Sequence number for operations (incremented for each op) */
  public seq: number = 1;

  /** Whether the connection can send messages */
  public canSend: boolean = false;

  /** Connection state */
  public state: 'connecting' | 'connected' | 'disconnected' = 'disconnected';

  /** The underlying transport */
  private transport: Transport | null = null;

  /** Map of collection -> id -> Doc */
  private docs: Map<string, Map<string, Doc>> = new Map();

  constructor() {
    super();
  }

  /**
   * Bind a transport to this connection.
   *
   * @param transport - The transport to use
   */
  bindToTransport(transport: Transport): void {
    this.transport = transport;
    this.state = 'connecting';
    this.emit('connecting');
  }

  /**
   * Handle an incoming message from the server.
   *
   * @param message - The message received
   */
  handleMessage(message: Message): void {
    switch (message.a) {
      case MessageType.HANDSHAKE:
        this._handleHandshake(message as HandshakeMessage);
        break;
      case MessageType.SUBSCRIBE:
        this._handleSubscribe(message as SubscribeMessage);
        break;
      case MessageType.OP:
        this._handleOp(message as OpMessage);
        break;
      default:
        console.warn('Unknown message type:', message.a);
    }
  }

  /**
   * Handle handshake message from server.
   */
  private _handleHandshake(message: HandshakeMessage): void {
    this.id = message.id;
    this.state = 'connected';
    this.canSend = true;
    this.emit('connected');

    // Flush any pending operations on docs
    for (const collectionDocs of this.docs.values()) {
      for (const doc of collectionDocs.values()) {
        doc._onConnectionStateChanged();
      }
    }
  }

  /**
   * Handle subscribe response from server.
   */
  private _handleSubscribe(message: SubscribeMessage): void {
    const doc = this._getDoc(message.c, message.d);
    if (doc) {
      doc._handleSubscribe(message.error, message.data);
    }
  }

  /**
   * Handle operation message from server.
   * This could be:
   * - Acknowledgement of our own op
   * - A remote op from another client
   */
  private _handleOp(message: OpMessage): void {
    const doc = this._getDoc(message.c, message.d);
    if (doc) {
      doc._handleOp(message.error, message);
    }
  }

  /**
   * Get a document, creating it if it doesn't exist.
   *
   * @param collection - Collection name
   * @param id - Document ID
   * @returns Doc instance
   *
   * Documents are cached per connection. Calling get() multiple times
   * with the same collection/id returns the same Doc instance.
   */
  get(collection: string, id: string): Doc {
    let collectionDocs = this.docs.get(collection);
    if (!collectionDocs) {
      collectionDocs = new Map();
      this.docs.set(collection, collectionDocs);
    }

    let doc = collectionDocs.get(id);
    if (!doc) {
      doc = new Doc(this, collection, id);
      collectionDocs.set(id, doc);
    }

    return doc;
  }

  /**
   * Get an existing document (internal).
   */
  private _getDoc(collection: string, id: string): Doc | undefined {
    return this.docs.get(collection)?.get(id);
  }

  /**
   * Send subscribe request to server.
   */
  sendSubscribe(doc: Doc): void {
    this._send({
      a: MessageType.SUBSCRIBE,
      c: doc.collection,
      d: doc.id,
    });
  }

  /**
   * Send unsubscribe request to server.
   */
  sendUnsubscribe(doc: Doc): void {
    this._send({
      a: MessageType.UNSUBSCRIBE,
      c: doc.collection,
      d: doc.id,
    });
  }

  /**
   * Send an operation to the server.
   *
   * @param doc - The document
   * @param op - The operation to send
   */
  sendOp(doc: Doc, op: Op & { src?: string; seq?: number }): void {
    const message: OpMessage = {
      a: MessageType.OP,
      c: doc.collection,
      d: doc.id,
      v: op.v,
      src: op.src,
      seq: op.seq,
    };

    // Add the specific operation type
    if ('create' in op) {
      message.create = op.create;
    } else if ('del' in op) {
      message.del = true;
    } else if ('op' in op) {
      message.op = op.op;
    }

    this._send(message);
  }

  /**
   * Send a message through the transport.
   */
  private _send(message: Message): void {
    if (!this.transport) {
      throw new Error('No transport bound to connection');
    }
    if (!this.canSend) {
      throw new Error('Connection cannot send messages');
    }
    this.transport.send(message);
  }

  /**
   * Close the connection.
   */
  close(): void {
    if (this.transport) {
      this.transport.close();
    }
    this.state = 'disconnected';
    this.canSend = false;
    this.emit('disconnected');
  }

  /**
   * Remove a document from the cache (internal).
   */
  _destroyDoc(doc: Doc): void {
    const collectionDocs = this.docs.get(doc.collection);
    if (collectionDocs) {
      collectionDocs.delete(doc.id);
      if (collectionDocs.size === 0) {
        this.docs.delete(doc.collection);
      }
    }
  }
}
