import { exec } from "child_process";

exec("redis-cli ping", (error, stdout) => {
  if (error || stdout.trim() !== "PONG") {
    exec("redis-server", (error) => {
      if (error) {
        console.error("Failed to start Redis server:", error);
      } else {
        console.log("Redis server started.");
      }
    });
  } else {
    console.log("Redis is already running.");
  }
});
