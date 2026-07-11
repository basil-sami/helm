// Local / self-hosted entrypoint. (Vercel uses /api/index.js instead.)
import { createApp } from "./app.js";

const app = createApp();
const PORT = process.env.PORT || 4000;
app.listen(PORT, () => console.log(`HELM API running on http://localhost:${PORT}`));
