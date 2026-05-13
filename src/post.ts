// src/post.ts
import * as core from '@actions/core';
import * as fs from 'fs';
import * as path from 'path';
import { fileURLToPath } from 'url'

const __dirname = path.dirname(fileURLToPath(import.meta.url))

try {
  let finalSpend = '0.00';
  const dataPath = path.join(__dirname, 'total_spend.txt');

  if (fs.existsSync(dataPath)) {
    finalSpend = parseFloat(fs.readFileSync(dataPath, 'utf8')).toFixed(5);
  }

  const limit = core.getInput('max_budget_usd');

  // Generate a native GitHub Step Summary Markdown UI Element
  core.summary
    .addHeading('📉 GenAI Cost Guardrail Telemetry')
    .addRaw(`The automated API cost sentinel analyzed outbound network requests during this run.`)
    .addTable([
      [{ data: 'Metric Metric', header: true }, { data: 'Value', header: true }],
      ['Total Billable API Cost ($)', `$${finalSpend} USD`],
      ['Step Allocation Ceiling ($)', `$${parseFloat(limit).toFixed(2)} USD`],
      ['Status Status', parseFloat(finalSpend) >= parseFloat(limit) ? '❌ BREACHED' : '✅ WITHIN BUDGET']
    ])
    .addRaw(`\n*Provides real-time tracking across OpenAI, Anthropic, Stability and Replicate.*`)
    .write();

  core.info('✅ Successfully rendered GenAI spending telemetry metrics.');
} catch (error: any) {
  core.warning(`Could not generate final cost summary: ${error.message}`);
}