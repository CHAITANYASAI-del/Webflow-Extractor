// Netlify function: /api/fx-cms  (CMS admin backend — see fx-server/handler.mjs)
import { handle } from '../../fx-server/handler.mjs';

export default (request) => handle(request, process.env);
export const config = { path: '/api/fx-cms' };
