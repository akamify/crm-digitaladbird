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
      name: 'crm-frontend',
      cwd: './frontend',
      script: 'node_modules/.bin/next',
      args: 'start -p 3000',
      instances: 1,
      exec_mode: 'fork',
      env: {
        NODE_ENV: 'production',
        PORT: 3000,
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
