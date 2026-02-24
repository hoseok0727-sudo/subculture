import { config } from "./config.js";
import { createApp } from "./app.js";

const app = createApp();

app.listen(config.apiPort, () => {
  console.log(`API listening on http://localhost:${config.apiPort}`);
});
