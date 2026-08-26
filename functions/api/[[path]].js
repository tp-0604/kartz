// Cloudflare Pages entry point.
//
// On Pages the site and its server-side code are one deployment, so this runs at /api/*
// on the same origin as index.html. That removes the two awkward parts of the GitHub Pages
// arrangement in one go: there is no cross-origin request, so Workers AI's missing CORS
// headers stop mattering, and there is no second thing to deploy and keep in step.
//
// The logic lives in worker.js so a standalone Worker deployment stays possible.
import worker from '../../worker.js';

export const onRequest = context => worker.fetch(context.request, context.env);
