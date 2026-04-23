import * as cdk from 'aws-cdk-lib';
import { Pipeline, Artifact } from 'aws-cdk-lib/aws-codepipeline';
import { CodeStarConnectionsSourceAction, CodeBuildAction } from 'aws-cdk-lib/aws-codepipeline-actions';
import { PipelineProject, BuildSpec, LinuxBuildImage, ComputeType } from 'aws-cdk-lib/aws-codebuild';
import * as iam from 'aws-cdk-lib/aws-iam';
import * as s3 from 'aws-cdk-lib/aws-s3';
import * as secretsmanager from 'aws-cdk-lib/aws-secretsmanager';
import { Construct } from 'constructs';

export interface EnvironmentConfig {
  name: string;
  account: string;
  region: string;
}

export interface PipelineStackProps extends cdk.StackProps {
  appName: string;
  githubOwner: string;
  githubRepo: string;
  githubBranch: string;
  connectionArn: string;
  environments: EnvironmentConfig[];
}

export class TestThursdayStackPipelineStack extends cdk.Stack {
  constructor(scope: Construct, id: string, props: PipelineStackProps) {
    super(scope, id, props);

    const envSecret = secretsmanager.Secret.fromSecretNameV2(
      this, 'EnvConfigSecret', `${props.appName}-pipeline-environments`,
    );

    const devopsAccountId = this.account;

    // CDK bootstrap role qualifier (default)
    const qualifier = 'hnb659fds';

    // Artifact bucket
    const artifactBucket = new s3.Bucket(this, 'ArtifactBucket', {
      versioned: true,
      encryption: s3.BucketEncryption.S3_MANAGED,
      removalPolicy: cdk.RemovalPolicy.DESTROY,
      autoDeleteObjects: true,
    });

    // Pipeline role — can assume CDK roles in DevOps account
    const pipelineRole = new iam.Role(this, 'PipelineRole', {
      assumedBy: new iam.CompositePrincipal(
        new iam.ServicePrincipal('codepipeline.amazonaws.com'),
        new iam.ServicePrincipal('codebuild.amazonaws.com'),
      ),
    });
    envSecret.grantRead(pipelineRole);

    // Allow pipeline role to assume CDK bootstrap roles in DevOps account (for synth/security)
    pipelineRole.addToPolicy(new iam.PolicyStatement({
      actions: ['sts:AssumeRole'],
      resources: [
        `arn:aws:iam::${devopsAccountId}:role/cdk-${qualifier}-deploy-role-${devopsAccountId}-*`,
        `arn:aws:iam::${devopsAccountId}:role/cdk-${qualifier}-file-publishing-role-${devopsAccountId}-*`,
        `arn:aws:iam::${devopsAccountId}:role/cdk-${qualifier}-lookup-role-${devopsAccountId}-*`,
      ],
    }));

    // Allow pipeline role to assume CDK bootstrap roles in each target environment account (for deploy)
    for (const env of props.environments) {
      pipelineRole.addToPolicy(new iam.PolicyStatement({
        actions: ['sts:AssumeRole'],
        resources: [
          `arn:aws:iam::${env.account}:role/cdk-${qualifier}-deploy-role-${env.account}-${env.region}`,
          `arn:aws:iam::${env.account}:role/cdk-${qualifier}-cfn-exec-role-${env.account}-${env.region}`,
          `arn:aws:iam::${env.account}:role/cdk-${qualifier}-file-publishing-role-${env.account}-${env.region}`,
          `arn:aws:iam::${env.account}:role/cdk-${qualifier}-image-publishing-role-${env.account}-${env.region}`,
          `arn:aws:iam::${env.account}:role/cdk-${qualifier}-lookup-role-${env.account}-${env.region}`,
        ],
      }));
    }

    // Pipeline role gets admin access in DevOps account for CDK deploy operations
    // Cross-account access remains scoped to CDK bootstrap roles
    pipelineRole.addManagedPolicy(
      iam.ManagedPolicy.fromAwsManagedPolicyName('AdministratorAccess'),
    );

    // Common env vars
    const envVars = {
      APP_NAME: { value: props.appName },
      DEVOPS_ACCOUNT: { value: devopsAccountId },
    };

    // Artifacts
    const sourceOutput = new Artifact('SourceOutput');
    const synthOutput = new Artifact('SynthOutput');
    const securityOutput = new Artifact('SecurityOutput');

    // Synth project — uses CDK roles in DevOps account
    const synthProject = new PipelineProject(this, 'SynthProject', {
      environment: { buildImage: LinuxBuildImage.STANDARD_7_0, computeType: ComputeType.MEDIUM },
      environmentVariables: envVars,
      role: pipelineRole,
      buildSpec: BuildSpec.fromSourceFilename('buildspecs/synth.yml'),
    });

    // DevSecOps project — uses CDK roles in DevOps account
    const devsecopsProject = new PipelineProject(this, 'DevSecOpsProject', {
      environment: { buildImage: LinuxBuildImage.STANDARD_7_0, computeType: ComputeType.MEDIUM, privileged: true },
      environmentVariables: envVars,
      role: pipelineRole,
      buildSpec: BuildSpec.fromSourceFilename('buildspecs/devsecops.yml'),
    });

    // Deploy project — assumes CDK roles in target environment account
    const deployProject = new PipelineProject(this, 'DeployProject', {
      environment: { buildImage: LinuxBuildImage.STANDARD_7_0, computeType: ComputeType.MEDIUM },
      environmentVariables: envVars,
      role: pipelineRole,
      buildSpec: BuildSpec.fromSourceFilename('buildspecs/deploy.yml'),
    });

    // Pipeline stages
    const stages: cdk.aws_codepipeline.StageProps[] = [
      {
        stageName: 'Source',
        actions: [new CodeStarConnectionsSourceAction({
          actionName: 'GitHub',
          owner: props.githubOwner,
          repo: props.githubRepo,
          branch: props.githubBranch,
          connectionArn: props.connectionArn,
          output: sourceOutput,
        })],
      },
      {
        stageName: 'Synth',
        actions: [new CodeBuildAction({
          actionName: 'CDKSynth',
          project: synthProject,
          input: sourceOutput,
          outputs: [synthOutput],
        })],
      },
      {
        stageName: 'DevSecOps',
        actions: [new CodeBuildAction({
          actionName: 'SecurityScan',
          project: devsecopsProject,
          input: sourceOutput,
          outputs: [securityOutput],
        })],
      },
    ];

    // Deploy stage per environment
    for (const env of props.environments) {
      stages.push({
        stageName: `Deploy-${env.name}`,
        actions: [new CodeBuildAction({
          actionName: `CDKDeploy-${env.name}`,
          project: deployProject,
          input: sourceOutput,
          environmentVariables: {
            DEPLOY_ACCOUNT: { value: env.account },
            DEPLOY_REGION: { value: env.region },
            DEPLOY_ENV: { value: env.name },
          },
        })],
      });
    }

    new Pipeline(this, 'Pipeline', {
      pipelineName: `${props.appName}-pipeline`,
      artifactBucket,
      role: pipelineRole,
      stages,
    });
  }
}
