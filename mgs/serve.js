const { config } = require("dotenv");
const path = require("path");
const { createServer } = require("http");
const cors = require("cors");
const app = require("express")();
const morgan = require("morgan");

config({ path: path.join(__dirname, ".env"), silent: true });

const host = process.env.HOST || "0.0.0.0";
const port = process.env.PORT || 7000;

app.use(morgan("tiny"));
app.use(cors());

const runServer = (_rec1, _rec2, _zkevmRec) => {
  app.get("/", (_, res) => {
    res.status(200).json(_rec1.servable()).end();
  });

  app.get("/v1", (_, res) => {
    res.status(200).json(_rec1.servable()).end();
  });

  app.get("/v2", (_, res) => {
    res.status(200).json(_rec2.servable()).end();
  });

  app.get("/zkevm", (_, res) => {
    res.status(200).json(_zkevmRec.servable()).end();
  });

  // healthcheck endpoint
  app.get("/health-check", (req, res) => {
    return res
      .status(200)
      .json({ success: true, message: "Health Check Success" });
  });

  // Invalid endpoint error handling
  app.use((req, res, next) => {
    const error = new Error("Not found");
    error.status = 404;
    next(error);
  });

  app.use((error, req, res, next) => {
    res.status(error.status || 500);
    res.json({
      error: {
        message: error.message,
      },
    });
  });

  createServer(app).listen(port, host, (_) => {
    console.log(`🔥 Listening at http://${host}:${port}`);
  });
};

module.exports = { runServer };
