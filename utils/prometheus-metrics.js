import client from "prom-client";
import { Gauge } from "prom-client";

// Collect default metrics
client.collectDefaultMetrics();

// Custom gauge for browser instances
const browserGauge = new client.Gauge({
  name: "bom_active_browser_instances",
  help: "Number of active browser instances",
});

// Custom gauge for proxy browser count
const proxyBrowserGauge = new Gauge({
  name: "bom_proxy_browser_count",
  help: "Number of browsers opened for each proxy",
  labelNames: ["proxy"],
});

// Custom gauge for RAM usage
const ramUsageGauge = new client.Gauge({
  name: "bom_total_ram_usage_gb",
  help: "Total RAM usage of all browser instances and the microservice in GB",
});

export { client, browserGauge, proxyBrowserGauge, ramUsageGauge };

// Function to get metrics
export async function getMetrics() {
  return client.register.metrics();
}

// Function to get content type
export function getContentType() {
  return client.register.contentType;
}
