export class AppError extends Error {
  constructor(
    public readonly status: number,
    public readonly code: string,
    message: string,
    public readonly details?: unknown,
  ) {
    super(message);
  }
}

export class BadRequest extends AppError {
  constructor(message = 'Bad request', details?: unknown) {
    super(400, 'bad_request', message, details);
  }
}
export class Unauthorized extends AppError {
  constructor(message = 'Sign in required') {
    super(401, 'unauthorized', message);
  }
}
export class Forbidden extends AppError {
  constructor(message = 'You do not have permission to do this') {
    super(403, 'forbidden', message);
  }
}
export class NotFound extends AppError {
  constructor(message = 'Not found') {
    super(404, 'not_found', message);
  }
}
export class Conflict extends AppError {
  constructor(message = 'Already exists') {
    super(409, 'conflict', message);
  }
}
