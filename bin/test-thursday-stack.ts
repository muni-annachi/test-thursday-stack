#!/usr/bin/env node
import 'source-map-support/register';
import * as cdk from 'aws-cdk-lib';
import { TestThursdayStackStack } from '../lib/test-thursday-stack-stack';

const app = new cdk.App();

new TestThursdayStackStack(app, 'test-thursday-stack', {
  env: {
    account: process.env.CDK_DEFAULT_ACCOUNT,
    region: process.env.CDK_DEFAULT_REGION || 'us-east-1',
  },
});

// --- Pipeline Stack (added by devops-pipeline-generator) ---
import { TestThursdayStackPipelineStack, EnvironmentConfig } from '../lib/test-thursday-stack-pipeline-stack';
import * as fs from 'fs';
import * as path from 'path';

const envConfigPath = path.join(__dirname, '..', 'environments.json');
const envConfig = JSON.parse(fs.readFileSync(envConfigPath, 'utf-8'));
const pipelineEnvironments: EnvironmentConfig[] = envConfig.environments;

// connectionArn: prefer environments.json, fallback to env var
const resolvedConnectionArn = envConfig.codestarConnectionArn
  && envConfig.codestarConnectionArn !== 'REPLACE_WITH_CONNECTION_ARN'
  ? envConfig.codestarConnectionArn
  : process.env.CODESTAR_CONNECTION_ARN;

// Only create pipeline stack when deploying to the DevOps account
// (skip when CDK_DEFAULT_ACCOUNT targets a workload account)
const isDevOpsAccount = !process.env.CDK_DEFAULT_ACCOUNT
  || process.env.CDK_DEFAULT_ACCOUNT === envConfig.devopsAccount;

if (isDevOpsAccount && resolvedConnectionArn) {
  new TestThursdayStackPipelineStack(app, 'test-thursday-stack-pipeline', {
    appName: envConfig.appName || 'test-thursday-stack',
    githubOwner: envConfig.githubOwner || 'muni-annachi',
    githubRepo: envConfig.githubRepo || 'test-thursday-stack',
    githubBranch: envConfig.githubBranch || 'main',
    connectionArn: resolvedConnectionArn,
    environments: pipelineEnvironments,
    env: {
      account: envConfig.devopsAccount,
      region: process.env.CDK_DEFAULT_REGION || 'us-east-1',
    },
  });
}
