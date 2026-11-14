/* Static asset host for the Hertz Forge mobile PWA.
   Routing, MIME types and caching are handled by the platform
   static asset layer; this Worker only forwards requests to it. */
export default {
  async fetch(request, env) {
    return env.ASSETS.fetch(request);
  }
};
