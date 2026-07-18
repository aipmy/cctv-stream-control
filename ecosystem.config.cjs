module.exports = {
  apps: [
    {
      name: "cctv-go2rtc",
      script: "./backend/bin/go2rtc",
      args: "-c ./backend/go2rtc.yaml",
      cwd: __dirname,
      watch: false,
      restart_delay: 5000,
      interpreter: "none"
    },
    {
      name: "cctv-monitoring-lite",
      cwd: __dirname,
      script: "backend/src/server.js",
      interpreter: "node",
      env: {
        NODE_ENV: "production",
        PORT: 4200
      },
      max_memory_restart: "2G",
      restart_delay: 3000,
      time: true
    }
  ]
};
