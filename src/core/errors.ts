export class HomeError extends Error {
  readonly code: string
  constructor(message: string, code = 'unknown') {
    super(message)
    this.name = 'HomeError'
    this.code = code
  }
}

export class UserError extends HomeError {
  override readonly name = 'UserError'
  constructor(message: string, code = 'user_error') {
    super(message, code)
  }
}

export class SystemError extends HomeError {
  override readonly name = 'SystemError'
  constructor(message: string, code = 'system_error') {
    super(message, code)
  }
}

export class NotConfiguredError extends HomeError {
  override readonly name = 'NotConfiguredError'
  constructor(module: string, code = 'not_configured') {
    super(`module "${module}" is not configured — run \`home ${module} configure\``, code)
  }
}

export function exitCodeFor(err: unknown): 1 | 2 | 3 {
  if (err instanceof NotConfiguredError) return 3
  if (err instanceof UserError) return 1
  return 2
}
