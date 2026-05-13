// src/proxy.ts
import { Proxy } from 'http-mitm-proxy';
import * as core from '@actions/core';
import * as github from '@actions/github';
import * as fs from 'fs';
import * as path from 'path';
import { calculateGenericCost } from './pricing.js';

const proxy = new Proxy();
let globalSpendUSD = 0;

// 1. Read parameters directly from the workflow configurations
const BUDGET_LIMIT_INPUT = core.getInput('max_budget_usd');
const BUDGET_LIMIT_USD = parseFloat(BUDGET_LIMIT_INPUT) || 2.00;

const TARGET_HOSTS = [
  'api.openai.com',
  'api.anthropic.com',
  'api.stability.ai',
  'api.replicate.com'
];

proxy.onRequest((ctx, callback) => {
  const host = ctx.clientToProxyRequest.headers.host || '';

  if (TARGET_HOSTS.includes(host)) {
    let requestChunks: Buffer[] = [];
    let detectedModel = 'unknown';

    ctx.onRequestData((ctx, chunk, callback) => {
      requestChunks.push(chunk);
      return callback(null, chunk);
    });

    ctx.onRequestEnd((ctx, callback) => {
      try {
        const reqBody = Buffer.concat(requestChunks).toString('utf8');
        if (reqBody) {
          const payload = JSON.parse(reqBody);
          detectedModel = payload.model || payload.version || 'unknown';

          // Advanced Check: If the developer is requesting a giant completion block,
          // calculate the potential max cost before letting it exit the runner network!
          if (payload.max_tokens) {
            const remainingBudget = BUDGET_LIMIT_USD - globalSpendUSD;
            // Estimate cost assuming the model consumes its entire max_tokens ceiling
            const potentialMaxCost = (payload.max_tokens / 1000) * 0.03; // Conservative average baseline ($0.03/1k tokens)

            if (potentialMaxCost > remainingBudget && remainingBudget > 0) {
              core.warning(`[GUARDRAIL PRE-CRASH] Incoming request for '${detectedModel}' requires up to max_tokens=${payload.max_tokens}. Remaining budget is only $${remainingBudget.toFixed(5)}. Spoofing rate limit rejection!`);

              // Short-circuit the connection! Send an HTTP 429 back to the test suite immediately
              ctx.proxyToClientResponse.writeHead(429, { 'Content-Type': 'application/json' });
              ctx.proxyToClientResponse.end(JSON.stringify({
                error: {
                  message: `Guardrail Circuit Breaker: This request could exceed your remaining workflow budget ($${remainingBudget.toFixed(4)} USD left). Request blocked.`,
                  type: "insufficient_budget",
                  code: "budget_limit_reached"
                }
              }));

              // Trigger the global workflow shutdown sequence
              globalSpendUSD = BUDGET_LIMIT_USD;
              evaluateBudgetStatus();
              return; // Stop processing this request sequence completely
            }
          }
        }
      } catch (e) {
        // Graceful fallback if the body cannot be parsed natively
      }
      return callback(null);
    });

    let responseChunks: Buffer[] = [];
    ctx.onResponseData((ctx, chunk, callback) => {
      responseChunks.push(chunk);
      return callback(null, chunk);
    });

    ctx.onResponseEnd((ctx, callback) => {
      const resBody = Buffer.concat(responseChunks).toString('utf8');
      try {
        if (resBody.trim().startsWith('{')) {
          const jsonRes = JSON.parse(resBody);
          if (jsonRes.usage) {
            const inputCost = calculateGenericCost(detectedModel, 'token_input', jsonRes.usage.prompt_tokens || 0);
            const outputCost = calculateGenericCost(detectedModel, 'token_output', jsonRes.usage.completion_tokens || 0);
            globalSpendUSD += (inputCost + outputCost);
          }
          evaluateBudgetStatus();
        }
      } catch (err) { }
      return callback(null);
    });
  }
  return callback();
});

async function evaluateBudgetStatus() {
  // Persist current metrics data for the post.ts step summary
  fs.writeFileSync(path.join(__dirname, 'total_spend.txt'), globalSpendUSD.toString());

  core.info(`[GUARDRAIL MONITOR] Accumulated Workflow Cost: $${globalSpendUSD.toFixed(5)} / $${BUDGET_LIMIT_USD.toFixed(2)}`);

  if (globalSpendUSD >= BUDGET_LIMIT_USD) {
    core.error(`\n🚨🚨🚨 [BUDGET BREACHED] Hard spending limit of $${BUDGET_LIMIT_USD} has been crossed! 🚨🚨🚨\n`);

    // Acquire the automatically generated system token from the environment
    const githubToken = process.env.GITHUB_TOKEN;

    if (githubToken) {
      try {
        const octokit = github.getOctokit(githubToken);
        const { owner, repo } = github.context.repo;
        const runId = github.context.runId;

        core.warning(`Sending remote cancellation signal to GitHub API for Workflow Run #${runId}...`);

        // Actively trigger GitHub's system-level workflow cancellation endpoint
        await octokit.rest.actions.cancelWorkflowRun({
          owner,
          repo,
          run_id: runId,
        });

        core.info("Cancellation command accepted by GitHub infrastructure.");
      } catch (apiError: any) {
        core.error(`Failed to trigger remote workflow cancellation API: ${apiError.message}`);
      }
    } else {
      core.warning("GITHUB_TOKEN environment variable not detected. Falling back to local process disruption.");
    }

    // Force an immediate local failure to prevent the current executing step from moving forward
    core.setFailed(`GenAI Cost Guardrail: Circuit Breaker tripped at $${globalSpendUSD.toFixed(5)} USD.`);
    process.exit(1);
  }
}

// Start Proxy Server
const PORT = 8080;
proxy.listen({ port: PORT }, () => {
  core.info(`🚀 Universal Model Guardrail Proxy listening on port ${PORT}`);

  // 2. FORCE ENFORCEMENT: Export systemic environment variables to the runner OS
  core.exportVariable('http_proxy', `http://127.0.0.1:${PORT}`);
  core.exportVariable('https_proxy', `http://127.0.0.1:${PORT}`);

  // Instruct Node/Python runners to trust the self-signed certificates we generate
  core.exportVariable('NODE_TLS_REJECT_UNAUTHORIZED', '0');
  core.exportVariable('PYTHONHTTPSVERIFY', '0');
});