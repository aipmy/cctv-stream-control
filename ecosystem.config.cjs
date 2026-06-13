module.exports = {
  apps: [
    {
      name: "cctv-monitoring-lite",
      cwd: __dirname,
      script: "backend/src/server.js",
      interpreter: "node",
      env: {
        NODE_ENV: "production",
        PORT: 4200
      },
      max_memory_restart: "512M",
      restart_delay: 3000,
      time: true
    }
  ]
};
