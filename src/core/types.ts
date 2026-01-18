/**
 * OT Type System
 *
 * Reference: lib/types.js in ShareDB
 *
 * An OT type defines how operations transform documents.
 * Each type must implement:
 * - name/uri: Unique identifiers
 * - create(data): Create initial document state
 * - apply(snapshot, op): Apply an operation to the snapshot
 * - transform(op1, op2, side): Transform op1 against op2
 *
 * Optional methods:
 * - compose(op1, op2): Compose two operations into one
 * - invert(op): Create an inverse operation for undo
 * - normalize(op): Normalize an operation
 */

/**
 * OT Type Interface
 *
 * TSnapshot: The type of the document snapshot (e.g., number, string)
 * TOp: The type of operations (e.g., number for counter, InsertOp|DeleteOp for text)
 */
export interface OTType<TSnapshot = unknown, TOp = unknown> {
  /** Short name for the type (e.g., 'counter', 'text') */
  name: string;

  /** Full URI identifier (e.g., 'http://sharejs.org/types/counter') */
  uri: string;

  /**
   * Create initial document state from optional data.
   *
   * @param data - Optional initial data
   * @returns The initial snapshot
   *
   * Example for counter type:
   *   create(5) => 5
   *   create() => 0
   */
  create(data?: unknown): TSnapshot;

  /**
   * Apply an operation to a snapshot.
   *
   * @param snapshot - Current document state
   * @param op - Operation to apply
   * @returns New snapshot after applying the operation
   *
   * IMPORTANT: This should NOT mutate the original snapshot.
   * Return a new snapshot instead.
   *
   * Example for counter type:
   *   apply(5, 3) => 8  // 5 + 3 = 8
   */
  apply(snapshot: TSnapshot, op: TOp): TSnapshot;

  /**
   * Transform op1 against op2.
   *
   * This is the heart of OT! When two operations are concurrent,
   * we need to transform one against the other so they can both be applied.
   *
   * @param op1 - The operation to transform
   * @param op2 - The operation that has already been applied
   * @param side - 'left' or 'right' for tie-breaking
   * @returns The transformed op1
   *
   * The transform function must satisfy:
   *   apply(apply(doc, op1), transform(op2, op1, 'right')) ===
   *   apply(apply(doc, op2), transform(op1, op2, 'left'))
   *
   * Example for counter type (addition is commutative):
   *   transform(3, 5, 'left') => 3  // No change needed!
   *
   * Example for text type (position adjustment needed):
   *   transform({insert: 'a', pos: 5}, {insert: 'b', pos: 3}, 'left')
   *   => {insert: 'a', pos: 6}  // Position shifts because 'b' was inserted before
   */
  transform(op1: TOp, op2: TOp, side: 'left' | 'right'): TOp;

  /**
   * Optional: Compose two operations into one.
   *
   * @param op1 - First operation
   * @param op2 - Second operation (applied after op1)
   * @returns Combined operation
   *
   * Must satisfy: apply(apply(doc, op1), op2) === apply(doc, compose(op1, op2))
   */
  compose?(op1: TOp, op2: TOp): TOp;

  /**
   * Optional: Create inverse operation for undo.
   *
   * @param op - Operation to invert
   * @returns Inverse operation
   *
   * Must satisfy: apply(apply(doc, op), invert(op)) === doc
   */
  invert?(op: TOp): TOp;

  /**
   * Optional: Normalize an operation (remove no-ops, etc.)
   *
   * @param op - Operation to normalize
   * @returns Normalized operation
   */
  normalize?(op: TOp): TOp;
}

/**
 * Type Registry - Manages registered OT types
 *
 * Reference: lib/types.js in ShareDB
 *
 * Types are registered by both name and URI to allow looking up
 * by either identifier.
 */
export class TypeRegistry {
  /** Map of type name/uri to type instance */
  private types: Map<string, OTType> = new Map();

  /** Default type to use when none specified */
  public defaultType: OTType | null = null;

  /**
   * Register a type.
   *
   * @param type - The OT type to register
   *
   * After registration, the type can be looked up by either name or URI.
   */
  register(type: OTType): void {
    this.types.set(type.name, type);
    this.types.set(type.uri, type);

    // Set as default if it's the first registered type
    if (!this.defaultType) {
      this.defaultType = type;
    }
  }

  /**
   * Get a type by name or URI.
   *
   * @param nameOrUri - Type name or URI
   * @returns The type, or undefined if not found
   */
  get(nameOrUri: string): OTType | undefined {
    return this.types.get(nameOrUri);
  }

  /**
   * Check if a type is registered.
   *
   * @param nameOrUri - Type name or URI
   * @returns true if registered
   */
  has(nameOrUri: string): boolean {
    return this.types.has(nameOrUri);
  }
}

// Global type registry instance
export const types = new TypeRegistry();
