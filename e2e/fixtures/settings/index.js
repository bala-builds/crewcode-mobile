import express from "express";
import cors from "cors";
import bodyParser from "body-parser";
import settingsRouter from "./routes/settings.js";
import { API_BASE } from "./config.js";

const app = express();
const PORT = process.env.PORT || 4001;

app.use(cors());
app.use(bodyParser.json());

app.get("/health", (req, res) => {
  res.json({ status: "ok", feature: "settings" });
});

app.use(`${API_BASE}/settings`, settingsRouter);

app.listen(PORT, () => {
  console.log(`Settings backend running on http://localhost:${PORT}`);
});
