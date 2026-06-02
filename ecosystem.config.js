/**
 * PM2 Ecosystem Configuration — DigitalADbird CRM
 *
 * Usage:
 *   pm2 start ecosystem.config.js          # start all
 *   pm2 start ecosystem.config.js --only crm-backend
 *   pm2 start ecosystem.config.js --only crm-frontend
 *   pm2 restart all
 *   pm2 logs
 *   pm2 save && pm2 startup               # auto-restart on reboot
 */
module.exports = {
  apps: [
    {
      name: 'crm-backend',
      cwd: './backend',
      script: 'src/server.js',
      instances: 1,               // single instance (stateful sessions)
      exec_mode: 'fork',
      env: {
        NODE_ENV: 'production',
        PORT: 4000,
        TZ: 'Asia/Kolkata',  // pins libc + Node Date semantics to IST
      },
      // Reads from backend/.env (dotenv in env.js)
      node_args: '--max-old-space-size=512',
      max_memory_restart: '500M',
      exp_backoff_restart_delay: 1000,
      max_restarts: 15,
      min_uptime: '10s',
      kill_timeout: 10000,
      listen_timeout: 15000,
      // Logging
      log_date_format: 'YYYY-MM-DD HH:mm:ss Z',
      error_file: '/var/log/pm2/crm-backend-error.log',
      out_file: '/var/log/pm2/crm-backend-out.log',
      merge_logs: true,
      // Watch (disabled in prod — use pm2 restart for deploys)
      watch: false,
    },
    {
      // Next.js standalone server — much smaller, faster cold-start than `next start`.
      // Requires `output: 'standalone'` in next.config.js (already set).
      // After `npm run build`, the deploy script copies .next/static and public into
      // .next/standalone/ so assets resolve.
      name: 'crm-frontend',
      cwd: './frontend',
      script: '.next/standalone/server.js',
      instances: 1,
      exec_mode: 'fork',
      env: {
        NODE_ENV: 'production',
        PORT: 3000,
        HOSTNAME: '0.0.0.0',
        TZ: 'Asia/Kolkata',  // pins frontend SSR Date formatting to IST
      },
      node_args: '--max-old-space-size=512',
      max_memory_restart: '500M',
      exp_backoff_restart_delay: 1000,
      max_restarts: 15,
      min_uptime: '10s',
      kill_timeout: 10000,
      listen_timeout: 15000,
      log_date_format: 'YYYY-MM-DD HH:mm:ss Z',
      error_file: '/var/log/pm2/crm-frontend-error.log',
      out_file: '/var/log/pm2/crm-frontend-out.log',
      merge_logs: true,
      watch: false,
    },
  ],
};
