import { createHttp } from './http-core';

/** Hooks the UI registers once (see `Providers`); kept out of the client so it stays testable. */
interface Handlers {
  onUnauthenticated: (() => void) | null;
  requestStepUp: (() => Promise<boolean>) | null;
}

export const handlers: Handlers = { onUnauthenticated: null, requestStepUp: null };

/** The single browser-side client for the admin API. */
export const http = createHttp({
  onUnauthenticated: () => handlers.onUnauthenticated?.(),
  requestStepUp: () => (handlers.requestStepUp ? handlers.requestStepUp() : Promise.resolve(false)),
});
