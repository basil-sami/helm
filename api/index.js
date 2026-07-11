// Vercel serverless function. vercel.json rewrites /api/* here.
// The Express app already namespaces routes under /api, matching the incoming path.
import { createApp } from "../backend/src/app.js";

const app = createApp();
export default app;
