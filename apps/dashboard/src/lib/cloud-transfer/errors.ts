/**
 * Why a Quasar export could not be read. The import UI maps each code to its own message, so the operator learns
 * whether to check the key, fetch a new export or update the node.
 */
export type CloudTransferErrorCode =
  'invalid-key' | 'not-an-export' | 'unsupported-version' | 'wrong-key' | 'corrupt' | 'too-large' | 'invalid-record';

export class CloudTransferError extends Error {
  constructor(
    readonly code: CloudTransferErrorCode,
    message: string,
  ) {
    super(message);
    this.name = 'CloudTransferError';
  }
}
