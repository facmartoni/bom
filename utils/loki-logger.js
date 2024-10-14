import winston from "winston";
import LokiTransport from "winston-loki";
import dotenv from "dotenv";

dotenv.config();

const { createLogger, format, transports } = winston;

// Configure the logger
const logger = createLogger({
  level: process.env.LOG_LEVEL || "info",
  format: format.combine(format.timestamp(), format.json()),
  defaultMeta: { service: process.env.LOKI_JOB || "bom-microservice" },
  transports: [
    new transports.Console(),
    new transports.File({ filename: "logs/bom-microservice.log" }),
    new LokiTransport({
      host: process.env.LOKI_HOST || "http://localhost:3100",
      labels: { job: process.env.LOKI_JOB || "bom-microservice" },
      json: true,
      format: format.json(),
      replaceTimestamp: true,
      onConnectionError: (err) => console.error(err),
    }),
  ],
});

export default logger;
