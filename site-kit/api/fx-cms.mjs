// Vercel function: /api/fx-cms  (CMS admin backend — see fx-server/handler.mjs)
import { handle } from '../fx-server/handler.mjs';

export function GET(request) { return handle(request, process.env); }
export function POST(request) { return handle(request, process.env); }
