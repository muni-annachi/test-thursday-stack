import * as cdk from 'aws-cdk-lib';
import * as ssm from 'aws-cdk-lib/aws-ssm';
import { Construct } from 'constructs';

export class TestThursdayStackStack extends cdk.Stack {
  constructor(scope: Construct, id: string, props?: cdk.StackProps) {
    super(scope, id, props);

    new ssm.StringParameter(this, 'ThursdayParam', {
      parameterName: '/test-thursday-stack/deployed-by',
      stringValue: 'devops-pipeline-mcp-server',
      description: 'Deployed via DevOps Pipeline MCP Server',
    });

    new cdk.CfnOutput(this, 'ParameterName', {
      value: '/test-thursday-stack/deployed-by',
    });
  }
}
