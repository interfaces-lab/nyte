/** The slice of the relay Durable Object binding the Worker uses: one stub per environment, named by its id. */
export interface RelayStub {
  fetch(request: Request): Promise<Response>;
}

export interface RelayNamespace {
  getByName(name: string): RelayStub;
}
