import { defineConfig, devices } from '@playwright/test'
const key='local-browser-usage-key-only-1234567890'
export default defineConfig({
 testDir:'./production-usage-tests',workers:1,timeout:120000,expect:{timeout:20000},
 use:{baseURL:'http://localhost:3100',...devices['Desktop Chrome'],launchOptions:process.env.PW_CHROMIUM_PATH?{executablePath:process.env.PW_CHROMIUM_PATH}:{}},
 webServer:[
  {command:'node fixtures/demo-kv.mjs',url:'http://127.0.0.1:4199',reuseExistingServer:false},
  {command:'node fixtures/production-usage-backend.mjs',url:'http://127.0.0.1:3101/health',reuseExistingServer:false,env:{JWT_SECRET:'local-browser-jwt-secret-only-1234567890',FRONTEND_URL:'http://localhost:3100',PORT:'3101',NODE_ENV:'test',LOG_LEVEL:'fatal',OPERATIONS_USAGE_KEY:key}},
  {command:'pnpm --filter frontend dev --port 3100',url:'http://localhost:3100',reuseExistingServer:false,timeout:120000,env:{NEXT_PUBLIC_DEMO_MODE:'true',NEXT_PUBLIC_DEMO_ADMIN_CONSOLE:'true',DEMO_ADMIN_EMAIL:'owner@example.test',DEMO_PUBLIC_URL:'https://public.example.test',DEMO_TRIAL_CREDENTIALS_KEY:'e'.repeat(64),KV_REST_API_URL:'http://127.0.0.1:4199',KV_REST_API_TOKEN:'local-e2e-only',BACKEND_URL:'http://127.0.0.1:3101',OPERATIONS_USAGE_BACKEND_URL:'http://127.0.0.1:3101',OPERATIONS_USAGE_KEY:key}},
 ]
})
