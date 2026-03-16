module.exports = {
  apps: [
    {
      name: 'exec-stream',
      script: 'dist/standalone.js',
      cwd: __dirname,
      instances: 1,
      exec_mode: 'fork',
      autorestart: true,
      watch: false,
      max_memory_restart: '256M',
      env: {
        NODE_ENV: 'production',
        EXEC_STREAM_PORT: 9200,
        EXEC_STREAM_JWT_SECRET: 'change-me-before-production',
        EXEC_STREAM_TOKEN_EXPIRY: 172800
      }
    }
  ]
};
