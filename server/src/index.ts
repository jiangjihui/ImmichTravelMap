import cors from "cors";
import express from "express";
import { config } from "./config.js";
import travelRouter from "./routes/travel.js";

const app = express();

app.use(
  cors({
    origin: config.WEB_ORIGIN,
    credentials: false
  })
);
app.use(express.json({ limit: "1mb" }));

app.get("/api/health", (_req, res) => {
  res.json({ ok: true });
});

app.use("/api/travel", travelRouter);

app.listen(config.PORT, () => {
  console.log(`Travel server running at http://localhost:${config.PORT}`);
});
