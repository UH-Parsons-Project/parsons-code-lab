// Global setup for Playwright tests
// Resets the database before running any tests

import { chromium } from '@playwright/test';

async function globalSetup() {
  console.log('Setting up test environment...');
  
  const baseURL = process.env.BASE_URL || 'http://localhost:8000';
  
  // Start a browser to make the HTTP request
  const browser = await chromium.launch();
  const context = await browser.newContext();
  const page = await context.newPage();
  
  try {
    console.log('Resetting database...');
    const response = await page.request.post(`${baseURL}/test/reset-db`);
    
    if (!response.ok()) {
      throw new Error(`Failed to reset database: ${response.status()} ${await response.text()}`);
    }
    
    console.log('Database reset');
  } catch (error) {
    console.error('Failed to reset database:', error);
    throw error;
  } finally {
    await browser.close();
  }
}

export default globalSetup;
