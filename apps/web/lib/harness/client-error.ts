export class HarnessClientError extends Error {
  readonly status: number;
  readonly code: string;
  readonly requestId: string;

  constructor(params: {
    status: number;
    code: string;
    message: string;
    requestId: string;
    cause?: unknown;
  }) {
    super(params.message, { cause: params.cause });
    this.name = "HarnessClientError";
    this.status = params.status;
    this.code = params.code;
    this.requestId = params.requestId;
  }
}
