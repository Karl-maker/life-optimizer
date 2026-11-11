/** A documented route exists, but its deployment-owned backing adapter is not configured. */
export class ApiDependencyUnavailableError extends Error {
  readonly statusCode = 503;

  constructor(dependency: string) {
    super(`${dependency} is not configured for this deployment.`);
    this.name = "ApiDependencyUnavailableError";
  }
}
